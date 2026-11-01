import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Neon client adapter exposes the parameterized sql.query contract', async () => {
  const source = await readFile(new URL('../server/database/client.js', import.meta.url), 'utf8');
  assert.match(source, /return sql\.query\(query, parameters\)/);
  assert.match(source, /query\(query, parameters = \[\]\)/);
});
