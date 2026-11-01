import { getDatabaseUrl } from './config.js';

export function createLocalPersistence() {
  return {
    mode: 'local',
    databaseEnabled: false,
    executor: null,
    repositories: null,
  };
}

export async function createPersistence({ environment = process.env, createClient } = {}) {
  const configuredDatabaseUrl = environment.DATABASE_URL;
  if (typeof configuredDatabaseUrl !== 'string' || !configuredDatabaseUrl.trim()) {
    return createLocalPersistence();
  }

  // Validate before importing the driver. A malformed configured URL is an
  // operational error, not a reason to silently fall back to ephemeral state.
  getDatabaseUrl(environment);
  const clientFactory = createClient ?? (await import('./client.js')).createDatabaseClient;
  const executor = clientFactory(environment);
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('Database client must return an executor with a query method.');
  }

  const repositories = await import('./repositories/index.js');
  return {
    mode: 'postgres',
    databaseEnabled: true,
    executor,
    repositories: {
      appSessions: repositories.createAppSessionRepository(executor),
      chatCommandCooldowns: repositories.createChatCommandCooldownRepository(executor),
      chatReplyOutbox: repositories.createChatReplyOutboxRepository(executor),
      eventSub: repositories.createEventSubRepository(executor),
      gameState: repositories.createGameStateRepository(executor),
      oauthSessions: repositories.createOAuthSessionRepository(executor),
      twitchAuthorizations: repositories.createTwitchAuthorizationRepository(executor, { environment }),
    },
  };
}
