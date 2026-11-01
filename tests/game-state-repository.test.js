import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStateRepository, GameStateConflictError } from '../server/database/repositories/game-state.js';

test('game state repository uses a revision predicate and returns an explicit conflict', async () => {
  const calls = [];
  const repository = createGameStateRepository({
    async query(query, parameters) {
      calls.push({ query, parameters });
      return [];
    },
  });

  await assert.rejects(
    repository.update({ broadcasterUserId: '42', state: { phase: 'investigating' }, expectedRevision: 3 }),
    (error) => error instanceof GameStateConflictError && error.code === 'GAME_STATE_REVISION_CONFLICT',
  );
  assert.match(calls[0].query, /WHERE broadcaster_user_id = \$3 AND revision = \$4/);
  assert.deepEqual(calls[0].parameters, [JSON.stringify({ phase: 'investigating' }), 1, '42', 3]);
});

test('game state repository returns the revision produced by a successful update', async () => {
  const repository = createGameStateRepository({
    async query() { return [{ state: { phase: 'voting' }, state_schema_version: 1, revision: 4 }]; },
  });
  const result = await repository.update({ broadcasterUserId: '42', state: { phase: 'voting' }, expectedRevision: 3 });
  assert.equal(result.revision, 4);
});

test('game state repository forwards query parameters through the executor query contract', async () => {
  const calls = [];
  const repository = createGameStateRepository({
    async query(query, parameters) {
      calls.push({ query, parameters });
      return [{ state: { phase: 'investigating' }, state_schema_version: 1, revision: 0 }];
    },
  });

  const result = await repository.get('broadcaster-7');
  assert.equal(result.revision, 0);
  assert.match(calls[0].query, /broadcaster_user_id = \$1/);
  assert.deepEqual(calls[0].parameters, ['broadcaster-7']);
});

test('createInitialState inserts once and returns the existing state after a concurrent insert', async () => {
  const calls = [];
  const repository = createGameStateRepository({
    async query(query, parameters) {
      calls.push({ query, parameters });
      if (query.includes('INSERT INTO game_states')) return [];
      return [{ state: { phase: 'investigating' }, state_schema_version: 1, revision: 0 }];
    },
  });

  const result = await repository.createInitialState({ broadcasterUserId: '42', state: { phase: 'investigating' } });
  assert.deepEqual(result, { created: false, state: { phase: 'investigating' }, state_schema_version: 1, revision: 0 });
  assert.match(calls[0].query, /ON CONFLICT \(broadcaster_user_id\) DO NOTHING/);
  assert.deepEqual(calls[0].parameters, ['42', JSON.stringify({ phase: 'investigating' }), 1]);
});
