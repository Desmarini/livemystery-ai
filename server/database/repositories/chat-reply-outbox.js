import { requireExecutor } from './helpers.js';

export function createChatReplyOutboxRepository(executor) {
  requireExecutor(executor);
  return {
    async enqueue({ replyId, idempotencyKey, broadcasterUserId, sourceEventMessageId = null, messageBody, notBefore = null }) {
      const rows = await executor.query(
        `INSERT INTO chat_replies (reply_id, idempotency_key, broadcaster_user_id, source_event_message_id, message_body, not_before)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING reply_id, idempotency_key, status, attempt_count, not_before`,
        [replyId, idempotencyKey, broadcasterUserId, sourceEventMessageId, messageBody, notBefore],
      );
      if (rows[0]) return { created: true, ...rows[0] };
      const existing = await executor.query(
        'SELECT reply_id, idempotency_key, status, attempt_count, not_before FROM chat_replies WHERE idempotency_key = $1',
        [idempotencyKey],
      );
      return existing[0] ? { created: false, ...existing[0] } : null;
    },
    async claimNext({ broadcasterUserId, lockToken, lockSeconds = 30, minimumIntervalSeconds = 0 }) {
      const rows = await executor.query(
        `WITH candidate AS (
           SELECT reply_id FROM chat_replies
           WHERE broadcaster_user_id = $1 AND status = 'queued' AND not_before <= NOW() AND attempt_count < 5
           ORDER BY not_before, created_at
           FOR UPDATE SKIP LOCKED LIMIT 1
         ), rate_grant AS (
           INSERT INTO chat_reply_rate_limits (broadcaster_user_id, last_reply_at)
           SELECT $1, NOW() WHERE EXISTS (SELECT 1 FROM candidate)
           ON CONFLICT (broadcaster_user_id) DO UPDATE SET last_reply_at = NOW()
             WHERE chat_reply_rate_limits.last_reply_at <= NOW() - ($4 * INTERVAL '1 second')
           RETURNING broadcaster_user_id
         )
         UPDATE chat_replies reply
         SET status = 'sending', attempt_count = reply.attempt_count + 1,
             locked_at = NOW(), locked_until = NOW() + ($3 * INTERVAL '1 second'), lock_token = $2
         FROM candidate
         WHERE reply.reply_id = candidate.reply_id AND EXISTS (SELECT 1 FROM rate_grant)
         RETURNING reply.reply_id, reply.broadcaster_user_id, reply.message_body, reply.attempt_count, reply.lock_token, reply.locked_until`,
        [broadcasterUserId, lockToken, lockSeconds, minimumIntervalSeconds],
      );
      return rows[0] || null;
    },
    async markSent({ replyId, lockToken, providerMessageId = null }) {
      const rows = await executor.query(
        `UPDATE chat_replies
         SET status = 'sent', sent_at = NOW(), provider_message_id = $1,
             locked_at = NULL, locked_until = NULL, lock_token = NULL
         WHERE reply_id = $2 AND status = 'sending' AND lock_token = $3
         RETURNING reply_id, status, sent_at, provider_message_id`,
        [providerMessageId, replyId, lockToken],
      );
      return rows[0] || null;
    },
    async releaseAfterFailure({ replyId, lockToken, failureCode }) {
      const rows = await executor.query(
        `UPDATE chat_replies
         SET status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'queued' END,
             failure_code = CASE WHEN attempt_count >= 5 THEN $1 ELSE NULL END,
             locked_at = NULL, locked_until = NULL, lock_token = NULL
         WHERE reply_id = $2 AND status = 'sending' AND lock_token = $3
         RETURNING reply_id, status, attempt_count, failure_code`,
        [failureCode, replyId, lockToken],
      );
      return rows[0] || null;
    },
    async reclaimExpired({ replyId, lockToken }) {
      const rows = await executor.query(
        `UPDATE chat_replies
         SET attempt_count = attempt_count + 1,
             status = CASE WHEN attempt_count + 1 >= 5 THEN 'failed' ELSE 'queued' END,
             failure_code = CASE WHEN attempt_count + 1 >= 5 THEN 'lock_expired' ELSE NULL END,
             locked_at = NULL, locked_until = NULL, lock_token = NULL
         WHERE reply_id = $1 AND status = 'sending' AND lock_token = $2 AND locked_until < NOW()
         RETURNING reply_id, status, attempt_count, failure_code`,
        [replyId, lockToken],
      );
      return rows[0] || null;
    },
  };
}
