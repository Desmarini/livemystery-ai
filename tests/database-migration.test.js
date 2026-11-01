import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('initial database migration is versioned and schema documents migration ownership', async () => {
  const [migration, schema] = await Promise.all([
    readFile(new URL('../database/migrations/001_initial.sql', import.meta.url), 'utf8'),
    readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'),
  ]);

  assert.match(migration, /Immutable initial migration/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS game_states/);
  assert.match(schema, /001_initial\.sql is the immutable initial migration/);
  assert.match(schema, /Never edit an applied migration/);
});
