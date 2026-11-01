import { createDatabaseClient } from '../../server/database/client.js';
import { createMigrateHandler } from '../../server/database/migrations/http-handler.js';
import { createMigrationRunner } from '../../server/database/migrations/runner.js';

export default createMigrateHandler({ createDatabaseClient, createMigrationRunner });

export const config = {
  path: '/api/admin/migrate',
  method: 'POST',
};
