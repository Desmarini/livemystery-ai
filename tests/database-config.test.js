import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabaseUrl } from '../server/database/config.js';

test('database configuration is lazy and rejects only missing database operations', () => {
  assert.throws(() => getDatabaseUrl({}), /DATABASE_URL is required/);
  assert.equal(getDatabaseUrl({ DATABASE_URL: 'postgresql://example.invalid/livemystery' }), 'postgresql://example.invalid/livemystery');
});
