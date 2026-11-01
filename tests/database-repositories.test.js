import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptToken, encryptToken, getTokenEncryptionConfig } from '../server/database/encryption.js';
import {
  createAppSessionRepository,
  createChatCommandCooldownRepository,
  createChatReplyOutboxRepository,
  createEventSubRepository,
  createOAuthSessionRepository,
  createTwitchAuthorizationRepository,
} from '../server/database/repositories/index.js';

function mockExecutor(responses = []) {
  const calls = [];
  return {
    calls,
    async query(query, parameters) {
      calls.push({ query, parameters });
      const response = responses.shift();
      return typeof response === 'function' ? response(query, parameters) : (response || []);
    },
  };
}

const encryptionEnvironment = {
  TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
  TOKEN_ENCRYPTION_KEY_VERSION: '2',
};

test('OAuth sessions are consumed atomically and duplicate state creation is idempotent', async () => {
  const executor = mockExecutor([[], [{ oauth_state_hash: 'hash', redirect_uri: 'https://example.invalid/callback' }]]);
  const repository = createOAuthSessionRepository(executor);
  assert.equal(await repository.create({ stateHash: 'hash', redirectUri: 'https://example.invalid/callback', expiresAt: '2030-01-01T00:00:00Z' }), null);
  assert.equal((await repository.consume('hash')).oauth_state_hash, 'hash');
  assert.match(executor.calls[0].query, /ON CONFLICT \(oauth_state_hash\) DO NOTHING/);
  assert.match(executor.calls[1].query, /consumed_at IS NULL AND expires_at > NOW\(\)/);
  assert.deepEqual(executor.calls[1].parameters, ['hash']);
});

test('AES-256-GCM token encryption round-trips and rejects missing or tampered key material', () => {
  const config = getTokenEncryptionConfig(encryptionEnvironment);
  const encrypted = encryptToken('access-token-value', config);
  assert.notEqual(encrypted.ciphertext, 'access-token-value');
  assert.equal(decryptToken(encrypted, config), 'access-token-value');
  assert.throws(() => getTokenEncryptionConfig({}), /TOKEN_ENCRYPTION_KEY_BASE64/);
  assert.throws(() => decryptToken({ ...encrypted, authTag: Buffer.alloc(16, 1).toString('base64') }, config));
});

test('Twitch authorizations encrypt token values before parameterized persistence and decrypt only on read', async () => {
  const executor = mockExecutor([
    [{ broadcaster_user_id: '1', broadcaster_login: 'streamer', access_token_expires_at: '2030-01-01T00:00:00Z', granted_scopes: ['chat:read'] }],
    [{ broadcaster_user_id: '1', broadcaster_login: 'streamer', access_token_ciphertext: '', access_token_nonce: '', access_token_auth_tag: '', refresh_token_ciphertext: '', refresh_token_nonce: '', refresh_token_auth_tag: '', token_encryption_algorithm: 'aes-256-gcm', token_encryption_key_version: 2, access_token_expires_at: '2030-01-01T00:00:00Z', granted_scopes: ['chat:read'] }],
  ]);
  const repository = createTwitchAuthorizationRepository(executor, { environment: encryptionEnvironment });
  await repository.save({ broadcasterUserId: '1', broadcasterLogin: 'streamer', accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: '2030-01-01T00:00:00Z', grantedScopes: ['chat:read'] });
  assert.match(executor.calls[0].query, /ON CONFLICT \(broadcaster_user_id\) DO UPDATE/);
  assert.notEqual(executor.calls[0].parameters[2], 'access');
  assert.notEqual(executor.calls[0].parameters[5], 'refresh');

  const stored = executor.calls[0].parameters;
  executor.calls.length = 0;
  const readExecutor = mockExecutor([[
    {
    broadcaster_user_id: '1', broadcaster_login: 'streamer',
    access_token_ciphertext: stored[2], access_token_nonce: stored[3], access_token_auth_tag: stored[4],
    refresh_token_ciphertext: stored[5], refresh_token_nonce: stored[6], refresh_token_auth_tag: stored[7],
    token_encryption_algorithm: 'aes-256-gcm', token_encryption_key_version: 2,
    access_token_expires_at: '2030-01-01T00:00:00Z', granted_scopes: ['chat:read'],
    },
  ]]);
  const loaded = await createTwitchAuthorizationRepository(readExecutor, { environment: encryptionEnvironment }).getActive('1');
  assert.equal(loaded.accessToken, 'access');
  assert.equal(loaded.refreshToken, 'refresh');

  const unavailableKeyExecutor = mockExecutor([{ ...readExecutor.calls[0] }]);
  // Key rotation never falls back to a different key: an unavailable version is rejected.
  unavailableKeyExecutor.query = async () => [{
    broadcaster_user_id: '1', broadcaster_login: 'streamer', token_encryption_algorithm: 'aes-256-gcm', token_encryption_key_version: 3,
    access_token_ciphertext: stored[2], access_token_nonce: stored[3], access_token_auth_tag: stored[4],
    refresh_token_ciphertext: stored[5], refresh_token_nonce: stored[6], refresh_token_auth_tag: stored[7],
  }];
  await assert.rejects(() => createTwitchAuthorizationRepository(unavailableKeyExecutor, { environment: encryptionEnvironment }).getActive('1'), /key version is unavailable/);
});

test('application session validation is a single conditional update', async () => {
  const executor = mockExecutor([[{ broadcaster_user_id: '1' }], []]);
  const repository = createAppSessionRepository(executor);
  assert.equal((await repository.validateAndTouch('session-hash')).broadcaster_user_id, '1');
  assert.equal(await repository.validateAndTouch('expired-or-revoked'), null);
  assert.match(executor.calls[0].query, /revoked_at IS NULL AND expires_at > NOW\(\)/);
});

test('EventSub messages deduplicate repeated delivery and completion is guarded by the claimed processing timestamp', async () => {
  const executor = mockExecutor([[{ message_id: 'event-1' }], [], [{ message_id: 'event-1', processing_started_at: '2030-01-01T00:00:00Z' }], []]);
  const repository = createEventSubRepository(executor);
  assert.equal((await repository.receiveMessage({ messageId: 'event-1', messageType: 'notification' })).accepted, true);
  assert.equal((await repository.receiveMessage({ messageId: 'event-1', messageType: 'notification' })).accepted, false);
  await repository.claimMessage('event-1');
  assert.equal(await repository.finishMessage({ messageId: 'event-1', processingStartedAt: 'stale-claim', status: 'processed' }), null);
  assert.match(executor.calls[0].query, /ON CONFLICT \(message_id\) DO NOTHING/);
  assert.match(executor.calls[2].query, /attempt_count < 5/);
  assert.match(executor.calls[3].query, /processing_started_at = \$4/);
});

test('EventSub subscriptions use only columns present in migration 001 and parameterized JSON condition', async () => {
  const executor = mockExecutor([[{ subscription_id: 'sub-1' }]]);
  await createEventSubRepository(executor).saveSubscription({
    subscriptionId: 'sub-1', broadcasterUserId: '1', subscriptionType: 'channel.chat.message', subscriptionVersion: '1',
    condition: { broadcaster_user_id: '1', user_id: '1' }, transport: 'websocket', twitchStatus: 'enabled', lifecycleState: 'active',
  });
  assert.match(executor.calls[0].query, /condition,\s*transport/);
  assert.match(executor.calls[0].query, /SET lifecycle_state = 'revoked'/);
  assert.deepEqual(executor.calls[0].parameters[4], JSON.stringify({ broadcaster_user_id: '1', user_id: '1' }));
});

test('cooldown claim uses an atomic conflict predicate so concurrent invocations have one winner', async () => {
  const executor = mockExecutor([[{ broadcaster_user_id: '1', chatter_user_id: '2' }], []]);
  const repository = createChatCommandCooldownRepository(executor);
  assert.ok(await repository.claim({ broadcasterUserId: '1', chatterUserId: '2', cooldownSeconds: 5 }));
  assert.equal(await repository.claim({ broadcasterUserId: '1', chatterUserId: '2', cooldownSeconds: 5 }), null);
  assert.match(executor.calls[0].query, /ON CONFLICT \(broadcaster_user_id, chatter_user_id\) DO UPDATE/);
  assert.match(executor.calls[0].query, /last_command_at <= NOW\(\)/);
});

test('outbox enqueue is idempotent, send completion requires its lock token, and expired locks consume retry budget', async () => {
  const executor = mockExecutor([[], [{ reply_id: 'reply-1', status: 'queued' }], [], [{ reply_id: 'reply-1', status: 'failed', attempt_count: 5, failure_code: 'lock_expired' }]]);
  const repository = createChatReplyOutboxRepository(executor);
  const duplicate = await repository.enqueue({ replyId: 'reply-1', idempotencyKey: 'event-1:reply', broadcasterUserId: '1', messageBody: 'safe response' });
  assert.equal(duplicate.created, false);
  assert.equal(await repository.markSent({ replyId: 'reply-1', lockToken: 'wrong' }), null);
  const reclaimed = await repository.reclaimExpired({ replyId: 'reply-1', lockToken: 'owner' });
  assert.equal(reclaimed.status, 'failed');
  assert.match(executor.calls[0].query, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(executor.calls[2].query, /status = 'sending' AND lock_token = \$3/);
  assert.match(executor.calls[3].query, /locked_until < NOW\(\)/);
  assert.match(executor.calls[3].query, /attempt_count \+ 1 >= 5/);
});

test('outbox claim atomically uses SKIP LOCKED and reserves the broadcaster rate-limit row', async () => {
  const executor = mockExecutor([[{ reply_id: 'reply-1', lock_token: 'lock-1' }]]);
  await createChatReplyOutboxRepository(executor).claimNext({ broadcasterUserId: '1', lockToken: 'lock-1', lockSeconds: 30, minimumIntervalSeconds: 2 });
  assert.match(executor.calls[0].query, /FOR UPDATE SKIP LOCKED/);
  assert.match(executor.calls[0].query, /INSERT INTO chat_reply_rate_limits/);
  assert.deepEqual(executor.calls[0].parameters, ['1', 'lock-1', 30, 2]);
});
