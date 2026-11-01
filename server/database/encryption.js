import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function decodeBase64(value, label) {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} must be a non-empty base64 value.`);
  }
  return Buffer.from(value, 'base64');
}

export function getTokenEncryptionConfig(environment = process.env) {
  const key = decodeBase64(environment.TOKEN_ENCRYPTION_KEY_BASE64, 'TOKEN_ENCRYPTION_KEY_BASE64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes.');

  const keyVersion = Number(environment.TOKEN_ENCRYPTION_KEY_VERSION ?? 1);
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0 || keyVersion > 32767) {
    throw new Error('TOKEN_ENCRYPTION_KEY_VERSION must be a positive small integer.');
  }
  return { algorithm: ALGORITHM, key, keyVersion };
}

export function encryptToken(plaintext, config) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new TypeError('Token plaintext must be a non-empty string.');
  if (!config || config.algorithm !== ALGORITHM || !Buffer.isBuffer(config.key) || config.key.length !== 32) {
    throw new TypeError('A valid AES-256-GCM encryption config is required.');
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, config.key, nonce, { authTagLength: AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptToken(encrypted, config) {
  if (!config || config.algorithm !== ALGORITHM || !Buffer.isBuffer(config.key) || config.key.length !== 32) {
    throw new TypeError('A valid AES-256-GCM encryption config is required.');
  }
  const nonce = decodeBase64(encrypted?.nonce, 'Token nonce');
  const authTag = decodeBase64(encrypted?.authTag, 'Token authentication tag');
  const ciphertext = decodeBase64(encrypted?.ciphertext, 'Token ciphertext');
  if (nonce.length !== NONCE_BYTES || authTag.length !== AUTH_TAG_BYTES) throw new Error('Encrypted token metadata has an invalid length.');
  const decipher = createDecipheriv(ALGORITHM, config.key, nonce, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
