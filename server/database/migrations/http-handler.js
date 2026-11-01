import { isMigrationAuthorized } from './admin-auth.js';

export function createMigrateHandler({ createDatabaseClient, createMigrationRunner, environment = process.env }) {
  if (typeof createDatabaseClient !== 'function' || typeof createMigrationRunner !== 'function') {
    throw new TypeError('Migration handler requires database client and runner factories.');
  }

  return async function migrate(request) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
    }
    if (!isMigrationAuthorized(request, environment)) {
      return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    }

    try {
      const executor = createDatabaseClient(environment);
      const runner = createMigrationRunner({ executor });
      const applied = await runner.run();
      return Response.json({ migrations: applied.map(({ version }) => version) });
    } catch {
      // Do not return database, filesystem, or driver error details to callers.
      return new Response('Migration failed', { status: 500 });
    }
  };
}
