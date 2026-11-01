export class GameStateConflictError extends Error {
  constructor(broadcasterUserId, expectedRevision) {
    super(`Game state revision conflict for broadcaster ${broadcasterUserId} at revision ${expectedRevision}.`);
    this.name = 'GameStateConflictError';
    this.code = 'GAME_STATE_REVISION_CONFLICT';
  }
}

export function createGameStateRepository(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('A database executor with a query method is required.');
  }

  return {
    async get(broadcasterUserId) {
      const rows = await executor.query(
        'SELECT state, state_schema_version, revision, updated_at FROM game_states WHERE broadcaster_user_id = $1',
        [broadcasterUserId],
      );
      return rows[0] || null;
    },

    async createInitialState({ broadcasterUserId, state, stateSchemaVersion = 1 }) {
      const rows = await executor.query(
        `INSERT INTO game_states (broadcaster_user_id, state, state_schema_version, revision)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (broadcaster_user_id) DO NOTHING
         RETURNING state, state_schema_version, revision, updated_at`,
        [broadcasterUserId, JSON.stringify(state), stateSchemaVersion],
      );
      if (rows[0]) return { created: true, ...rows[0] };

      const existing = await this.get(broadcasterUserId);
      if (!existing) throw new Error(`Game state bootstrap did not return a row for broadcaster ${broadcasterUserId}.`);
      return { created: false, ...existing };
    },

    async update({ broadcasterUserId, state, stateSchemaVersion = 1, expectedRevision }) {
      const rows = await executor.query(
        `UPDATE game_states
         SET state = $1, state_schema_version = $2, revision = revision + 1
         WHERE broadcaster_user_id = $3 AND revision = $4
         RETURNING state, state_schema_version, revision, updated_at`,
        [JSON.stringify(state), stateSchemaVersion, broadcasterUserId, expectedRevision],
      );
      if (!rows[0]) throw new GameStateConflictError(broadcasterUserId, expectedRevision);
      return rows[0];
    },
  };
}
