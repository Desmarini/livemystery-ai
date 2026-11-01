import { requireExecutor } from './helpers.js';

export function createOAuthSessionRepository(executor) {
  requireExecutor(executor);
  return {
    async create({ stateHash, redirectUri, expiresAt }) {
      const rows = await executor.query(
        `INSERT INTO oauth_sessions (oauth_state_hash, redirect_uri, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (oauth_state_hash) DO NOTHING
         RETURNING oauth_state_hash, redirect_uri, expires_at, consumed_at`,
        [stateHash, redirectUri, expiresAt],
      );
      return rows[0] || null;
    },
    async consume(stateHash) {
      const rows = await executor.query(
        `UPDATE oauth_sessions
         SET consumed_at = NOW()
         WHERE oauth_state_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
         RETURNING oauth_state_hash, redirect_uri, expires_at, consumed_at`,
        [stateHash],
      );
      return rows[0] || null;
    },
  };
}
