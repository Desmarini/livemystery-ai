import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isMigrationAuthorized } from '../server/database/migrations/admin-auth.js';
import { createMigrateHandler } from '../server/database/migrations/http-handler.js';

const environment = { MIGRATION_ADMIN_TOKEN: 'test-admin-token' };

function request(authorization, method = 'POST') {
  return new Request('https://example.invalid/api/admin/migrate', {
    method,
    headers: authorization ? { authorization } : {},
  });
}

test('migration endpoint authorizes only the configured Bearer token', () => {
  assert.equal(isMigrationAuthorized(request('Bearer test-admin-token'), environment), true);
  assert.equal(isMigrationAuthorized(request('Bearer wrong-token'), environment), false);
  assert.equal(isMigrationAuthorized(request(), environment), false);
  assert.equal(isMigrationAuthorized(request('Basic test-admin-token'), environment), false);
  assert.equal(isMigrationAuthorized(request('Bearer test-admin-token'), {}), false);
});

test('migration endpoint rejects an unauthorized request before creating a database client', async () => {
  let databaseClientCreated = false;
  const handler = createMigrateHandler({
    environment,
    createDatabaseClient() {
      databaseClientCreated = true;
      throw new Error('must not be called');
    },
    createMigrationRunner() {
      throw new Error('must not be called');
    },
  });

  const response = await handler(request());
  assert.equal(response.status, 401);
  assert.equal(databaseClientCreated, false);
});

test('migration endpoint runs the existing runner only after authorization', async () => {
  const executor = { query() {} };
  let receivedExecutor;
  const handler = createMigrateHandler({
    environment,
    createDatabaseClient(receivedEnvironment) {
      assert.equal(receivedEnvironment, environment);
      return executor;
    },
    createMigrationRunner({ executor: actualExecutor }) {
      receivedExecutor = actualExecutor;
      return { async run() { return [{ version: '001_initial' }, { version: '002_schema_migrations' }]; } };
    },
  });

  const response = await handler(request('Bearer test-admin-token'));
  assert.equal(response.status, 200);
  assert.equal(receivedExecutor, executor);
  assert.deepEqual(await response.json(), { migrations: ['001_initial', '002_schema_migrations'] });
});

test('migration endpoint only allows explicit POST invocation', async () => {
  const handler = createMigrateHandler({
    environment,
    createDatabaseClient() { throw new Error('must not be called'); },
    createMigrationRunner() { throw new Error('must not be called'); },
  });

  const response = await handler(request('Bearer test-admin-token', 'GET'));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});

test('Netlify migrate function bundles SQL migrations and uses the existing runner', async () => {
  const [netlifyConfig, functionSource] = await Promise.all([
    readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/migrate.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(netlifyConfig, /\[functions\.migrate\][\s\S]*included_files\s*=\s*\["database\/migrations\/\*\*"\]/);
  assert.match(functionSource, /createMigrationRunner/);
  assert.match(functionSource, /path:\s*'\/api\/admin\/migrate'/);
});
