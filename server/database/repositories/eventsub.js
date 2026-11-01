import { asJson, requireExecutor } from './helpers.js';

export function createEventSubRepository(executor) {
  requireExecutor(executor);
  return {
    async saveSubscription({ subscriptionId, broadcasterUserId, subscriptionType, subscriptionVersion, condition, transport, callbackUrl = null, webhookSecretKeyVersion = null, twitchStatus, lifecycleState = 'pending' }) {
      const rows = await executor.query(
        `WITH retired AS (
           UPDATE eventsub_subscriptions
           SET lifecycle_state = 'revoked'
           WHERE broadcaster_user_id = $2 AND subscription_type = $3 AND transport = $6
             AND subscription_id <> $1 AND lifecycle_state IN ('pending', 'active')
         )
         INSERT INTO eventsub_subscriptions (
           subscription_id, broadcaster_user_id, subscription_type, subscription_version, condition,
           transport, callback_url, webhook_secret_key_version, twitch_status, lifecycle_state
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
         ON CONFLICT (subscription_id) DO UPDATE SET
           broadcaster_user_id = EXCLUDED.broadcaster_user_id,
           subscription_type = EXCLUDED.subscription_type,
           subscription_version = EXCLUDED.subscription_version,
           condition = EXCLUDED.condition,
           transport = EXCLUDED.transport,
           callback_url = EXCLUDED.callback_url,
           webhook_secret_key_version = EXCLUDED.webhook_secret_key_version,
           twitch_status = EXCLUDED.twitch_status,
           lifecycle_state = EXCLUDED.lifecycle_state
         RETURNING subscription_id, broadcaster_user_id, subscription_type, subscription_version, condition, transport, callback_url, twitch_status, lifecycle_state`,
        [subscriptionId, broadcasterUserId, subscriptionType, subscriptionVersion, asJson(condition), transport,
          callbackUrl, webhookSecretKeyVersion, twitchStatus, lifecycleState],
      );
      return rows[0] || null;
    },
    async receiveMessage({ messageId, subscriptionId = null, messageType }) {
      const rows = await executor.query(
        `INSERT INTO eventsub_messages (message_id, subscription_id, message_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id) DO NOTHING
         RETURNING message_id, subscription_id, message_type, processing_status, attempt_count, received_at`,
        [messageId, subscriptionId, messageType],
      );
      return rows[0] ? { accepted: true, message: rows[0] } : { accepted: false, message: null };
    },
    async claimMessage(messageId, staleAfterSeconds = 60) {
      const rows = await executor.query(
        `WITH exhausted AS (
           UPDATE eventsub_messages
           SET processing_status = 'failed', processed_at = NOW(), failure_code = 'retry_exhausted'
           WHERE message_id = $1 AND processing_status = 'processing' AND attempt_count >= 5
             AND processing_started_at < NOW() - ($2 * INTERVAL '1 second')
           RETURNING message_id
         ), claimed AS (
           UPDATE eventsub_messages
           SET processing_status = 'processing', processing_started_at = NOW(), attempt_count = attempt_count + 1
           WHERE message_id = $1 AND attempt_count < 5
             AND (processing_status = 'received'
                  OR (processing_status = 'processing' AND processing_started_at < NOW() - ($2 * INTERVAL '1 second')))
             AND NOT EXISTS (SELECT 1 FROM exhausted)
           RETURNING message_id, processing_status, processing_started_at, attempt_count
         )
         SELECT message_id, processing_status, processing_started_at, attempt_count FROM claimed`,
        [messageId, staleAfterSeconds],
      );
      return rows[0] || null;
    },
    async finishMessage({ messageId, processingStartedAt, status, failureCode = null }) {
      if (!['processed', 'ignored', 'failed'].includes(status)) throw new TypeError('EventSub terminal status is invalid.');
      const rows = await executor.query(
        `UPDATE eventsub_messages
         SET processing_status = $1, processed_at = NOW(), failure_code = $2
         WHERE message_id = $3 AND processing_status = 'processing' AND processing_started_at = $4
         RETURNING message_id, processing_status, processed_at, failure_code`,
        [status, failureCode, messageId, processingStartedAt],
      );
      return rows[0] || null;
    },
  };
}
