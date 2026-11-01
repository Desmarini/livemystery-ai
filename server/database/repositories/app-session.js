import { requireExecutor } from './helpers.js';

export function createAppSessionRepository(executor) {
  requireExecutor(executor);
  return {
    async create({ sessionIdHash, broadcasterUserId, expiresAt }) {
      const rows = await executor.query(
        `INSERT INTO app_sessions (session_id_hash, broadcaster_user_id, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id_hash) DO NOTHING
         RETURNING session_id_hash, broadcaster_user_id, expires_at, revoked_at`,
        [sessionIdHash, broadcasterUserId, expiresAt],
      );
      return rows[0] || null;
    },
    async validateAndTouch(sessionIdHash) {
      const rows = await executor.query(
        `UPDATE app_sessions SET last_seen_at = NOW()
         WHERE session_id_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
         RETURNING broadcaster_user_id, expires_at, last_seen_at`,
        [sessionIdHash],
      );
      return rows[0] || null;
    },
    async revoke(sessionIdHash) {
      const rows = await executor.query(
        'UPDATE app_sessions SET revoked_at = NOW() WHERE session_id_hash = $1 AND revoked_at IS NULL RETURNING session_id_hash, revoked_at',
        [sessionIdHash],
      );
      return rows[0] || null;
    },
  };
}
