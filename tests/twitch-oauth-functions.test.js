import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { APP_SESSION_COOKIE_NAME, createTwitchOAuthHandlers } from '../server/twitch/netlify-oauth.js';

const environment = {
  DATABASE_URL: 'postgresql://example.invalid/livemystery',
  TWITCH_CLIENT_ID: 'client-id',
  TWITCH_CLIENT_SECRET: 'client-secret',
  TWITCH_REDIRECT_URI: 'https://live.example/api/twitch/callback',
};
const fixedNow = () => new Date('2030-01-01T00:00:00.000Z');
const hash = (value) => createHash('sha256').update(value).digest('hex');

function randomValues(...values) {
  return () => Buffer.from(values.shift(), 'utf8');
}

function createRepositories({ consumed = { redirect_uri: environment.TWITCH_REDIRECT_URI }, session = { session_id_hash: 'stored' } } = {}) {
  const calls = { createdStates: [], consumedStates: [], savedAuthorizations: [], createdSessions: [] };
  return {
    calls,
    repositories: {
      oauthSessions: {
        async create(input) { calls.createdStates.push(input); return { oauth_state_hash: input.stateHash }; },
        async consume(input) { calls.consumedStates.push(input); return consumed; },
      },
      twitchAuthorizations: {
        async save(input) { calls.savedAuthorizations.push(input); return { broadcaster_user_id: input.broadcasterUserId }; },
      },
      appSessions: {
        async create(input) { calls.createdSessions.push(input); return session; },
      },
    },
  };
}

function persistenceFactory(repositories) {
  return async () => ({ mode: 'postgres', repositories });
}

function okJson(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('OAuth connect stores only a state hash and redirects without client secret', async () => {
  const { calls, repositories } = createRepositories();
  const handlers = createTwitchOAuthHandlers({
    createPersistence: persistenceFactory(repositories), environment, now: fixedNow, randomBytesImpl: randomValues('oauth-state'),
  });

  const response = await handlers.connect();
  const redirect = new URL(response.headers.get('location'));
  assert.equal(response.status, 302);
  assert.equal(redirect.origin, 'https://id.twitch.tv');
  assert.equal(redirect.searchParams.get('state'), Buffer.from('oauth-state').toString('base64url'));
  assert.equal(calls.createdStates[0].stateHash, hash(redirect.searchParams.get('state')));
  assert.notEqual(calls.createdStates[0].stateHash, redirect.searchParams.get('state'));
  assert.equal(redirect.searchParams.get('client_secret'), null);
  assert.equal(response.headers.get('location').includes(environment.TWITCH_CLIENT_SECRET), false);
});

test('OAuth callback consumes state once, persists exchange tokens, and creates a hashed session cookie', async () => {
  const { calls, repositories } = createRepositories();
  const fetchCalls = [];
  const handlers = createTwitchOAuthHandlers({
    createPersistence: persistenceFactory(repositories), environment, now: fixedNow,
    randomBytesImpl: randomValues('session-id'),
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url.includes('/oauth2/token')) return okJson({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: ['chat:read', 'chat:edit'] });
      return okJson({ data: [{ id: '42', login: 'desmarini' }] });
    },
  });
  const state = 'state-from-browser';

  const response = await handlers.callback(new Request(`https://live.example/api/twitch/callback?code=code-value&state=${state}`));
  assert.equal(response.status, 302);
  assert.deepEqual(calls.consumedStates, [hash(state)]);
  assert.deepEqual(calls.savedAuthorizations[0], {
    broadcasterUserId: '42', broadcasterLogin: 'desmarini', accessToken: 'access', refreshToken: 'refresh',
    accessTokenExpiresAt: '2030-01-01T01:00:00.000Z', grantedScopes: ['chat:read', 'chat:edit'],
  });
  const rawSession = Buffer.from('session-id').toString('base64url');
  assert.equal(calls.createdSessions[0].sessionIdHash, hash(rawSession));
  assert.notEqual(calls.createdSessions[0].sessionIdHash, rawSession);
  assert.match(response.headers.get('set-cookie'), new RegExp(`^${APP_SESSION_COOKIE_NAME}=${rawSession};`));
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(fetchCalls.length, 2);
  assert.equal(new URLSearchParams(fetchCalls[0].options.body).get('client_secret'), environment.TWITCH_CLIENT_SECRET);
});

test('OAuth callback rejects invalid or replayed state before token exchange', async () => {
  const { calls, repositories } = createRepositories({ consumed: null });
  let fetchCalled = false;
  const handlers = createTwitchOAuthHandlers({
    createPersistence: persistenceFactory(repositories), environment,
    fetchImpl: async () => { fetchCalled = true; throw new Error('must not be called'); },
  });

  const response = await handlers.callback(new Request('https://live.example/api/twitch/callback?code=code&state=replay'));
  assert.equal(response.status, 400);
  assert.equal(fetchCalled, false);
  assert.equal(calls.savedAuthorizations.length, 0);
  assert.equal(calls.createdSessions.length, 0);
});

test('OAuth callback never creates a session when token exchange or identity lookup fails', async () => {
  for (const failureAt of ['token', 'identity']) {
    const { calls, repositories } = createRepositories();
    const handlers = createTwitchOAuthHandlers({
      createPersistence: persistenceFactory(repositories), environment,
      fetchImpl: async (url) => {
        if (failureAt === 'token' && url.includes('/oauth2/token')) return new Response('', { status: 401 });
        if (failureAt === 'identity' && url.includes('/helix/users')) return new Response('', { status: 401 });
        return okJson({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: [] });
      },
    });
    const response = await handlers.callback(new Request('https://live.example/api/twitch/callback?code=code&state=state'));
    assert.equal(response.status, 502);
    assert.equal(calls.createdSessions.length, 0);
    assert.equal(calls.savedAuthorizations.length, 0);
  }
});

test('OAuth handlers require PostgreSQL persistence and do not use local memory fallback', async () => {
  const handlers = createTwitchOAuthHandlers({
    createPersistence: async () => ({ mode: 'local', repositories: null }), environment,
  });
  const response = await handlers.connect();
  assert.equal(response.status, 503);
});
