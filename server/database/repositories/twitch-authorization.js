import { decryptToken, encryptToken, getTokenEncryptionConfig } from '../encryption.js';
import { requireExecutor } from './helpers.js';

export function createTwitchAuthorizationRepository(executor, { environment = process.env } = {}) {
  requireExecutor(executor);
  return {
    async save({ broadcasterUserId, broadcasterLogin, accessToken, refreshToken, accessTokenExpiresAt, grantedScopes }) {
      const config = getTokenEncryptionConfig(environment);
      const access = encryptToken(accessToken, config);
      const refresh = encryptToken(refreshToken, config);
      const rows = await executor.query(
        `INSERT INTO twitch_authorizations (
           broadcaster_user_id, broadcaster_login,
           access_token_ciphertext, access_token_nonce, access_token_auth_tag,
           refresh_token_ciphertext, refresh_token_nonce, refresh_token_auth_tag,
           token_encryption_algorithm, token_encryption_key_version,
           access_token_expires_at, granted_scopes, revoked_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)
         ON CONFLICT (broadcaster_user_id) DO UPDATE SET
           broadcaster_login = EXCLUDED.broadcaster_login,
           access_token_ciphertext = EXCLUDED.access_token_ciphertext,
           access_token_nonce = EXCLUDED.access_token_nonce,
           access_token_auth_tag = EXCLUDED.access_token_auth_tag,
           refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
           refresh_token_nonce = EXCLUDED.refresh_token_nonce,
           refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
           token_encryption_algorithm = EXCLUDED.token_encryption_algorithm,
           token_encryption_key_version = EXCLUDED.token_encryption_key_version,
           access_token_expires_at = EXCLUDED.access_token_expires_at,
           granted_scopes = EXCLUDED.granted_scopes,
           revoked_at = NULL
         RETURNING broadcaster_user_id, broadcaster_login, access_token_expires_at, granted_scopes, revoked_at, updated_at`,
        [broadcasterUserId, broadcasterLogin, access.ciphertext, access.nonce, access.authTag,
          refresh.ciphertext, refresh.nonce, refresh.authTag, config.algorithm, config.keyVersion,
          accessTokenExpiresAt, grantedScopes],
      );
      return rows[0] || null;
    },
    async getActive(broadcasterUserId) {
      const rows = await executor.query(
        `SELECT broadcaster_user_id, broadcaster_login,
                access_token_ciphertext, access_token_nonce, access_token_auth_tag,
                refresh_token_ciphertext, refresh_token_nonce, refresh_token_auth_tag,
                token_encryption_algorithm, token_encryption_key_version,
                access_token_expires_at, granted_scopes
         FROM twitch_authorizations
         WHERE broadcaster_user_id = $1 AND revoked_at IS NULL`,
        [broadcasterUserId],
      );
      const row = rows[0];
      if (!row) return null;
      const config = getTokenEncryptionConfig(environment);
      if (row.token_encryption_algorithm !== config.algorithm) throw new Error('Stored token encryption algorithm is unsupported.');
      if (row.token_encryption_key_version !== config.keyVersion) throw new Error('Stored token encryption key version is unavailable.');
      return {
        broadcasterUserId: row.broadcaster_user_id,
        broadcasterLogin: row.broadcaster_login,
        accessToken: decryptToken({ ciphertext: row.access_token_ciphertext, nonce: row.access_token_nonce, authTag: row.access_token_auth_tag }, config),
        refreshToken: decryptToken({ ciphertext: row.refresh_token_ciphertext, nonce: row.refresh_token_nonce, authTag: row.refresh_token_auth_tag }, config),
        accessTokenExpiresAt: row.access_token_expires_at,
        grantedScopes: row.granted_scopes,
      };
    },
    async revoke(broadcasterUserId) {
      const rows = await executor.query(
        'UPDATE twitch_authorizations SET revoked_at = NOW() WHERE broadcaster_user_id = $1 AND revoked_at IS NULL RETURNING broadcaster_user_id, revoked_at',
        [broadcasterUserId],
      );
      return rows[0] || null;
    },
  };
}
