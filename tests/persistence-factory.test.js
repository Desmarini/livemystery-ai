import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence } from '../server/database/persistence.js';

test('persistence factory selects local mode without DATABASE_URL and does not create a client', async () => {
  let clientCreated = false;
  const persistence = await createPersistence({
    environment: {},
    createClient() {
      clientCreated = true;
      throw new Error('must not be called');
    },
  });

  assert.equal(persistence.mode, 'local');
  assert.equal(persistence.databaseEnabled, false);
  assert.equal(persistence.executor, null);
  assert.equal(persistence.repositories, null);
  assert.equal(clientCreated, false);
});

test('persistence factory selects PostgreSQL only with a valid configured DATABASE_URL', async () => {
  const executor = { async query() { return []; } };
  let receivedEnvironment;
  const environment = { DATABASE_URL: 'postgresql://example.invalid/livemystery' };
  const persistence = await createPersistence({
    environment,
    createClient(actualEnvironment) {
      receivedEnvironment = actualEnvironment;
      return executor;
    },
  });

  assert.equal(persistence.mode, 'postgres');
  assert.equal(persistence.databaseEnabled, true);
  assert.equal(persistence.executor, executor);
  assert.equal(receivedEnvironment, environment);
  assert.equal(typeof persistence.repositories.gameState.get, 'function');
  assert.equal(typeof persistence.repositories.oauthSessions.consume, 'function');
  assert.equal(typeof persistence.repositories.chatReplyOutbox.claimNext, 'function');
});

test('persistence factory rejects a malformed configured DATABASE_URL instead of silently using local state', async () => {
  await assert.rejects(
    createPersistence({ environment: { DATABASE_URL: 'not-a-postgres-url' }, createClient() { throw new Error('must not be called'); } }),
    /valid PostgreSQL connection URL/,
  );
});
