import test from 'node:test';
import assert from 'node:assert/strict';
import { TwitchIntegration } from '../server/twitch.js';

function fakeResponse() {
  return {
    headers: null,
    status: null,
    ended: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end() { this.ended = true; },
  };
}

test('Connect starts a server-side authorization-code flow with exact callback and no secret in the URL', () => {
  const integration = new TwitchIntegration({
    clientId: 'local-client-id',
    clientSecret: 'unit-test-placeholder-secret',
    redirectUri: 'http://localhost:4173/auth/twitch/callback',
    onStatus() {},
    onCommand() {},
  });
  const response = fakeResponse();
  integration.start(response);
  const authorize = new URL(response.headers.Location);

  assert.equal(response.status, 302);
  assert.equal(authorize.origin + authorize.pathname, 'https://id.twitch.tv/oauth2/authorize');
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('client_id'), 'local-client-id');
  assert.equal(authorize.searchParams.get('redirect_uri'), 'http://localhost:4173/auth/twitch/callback');
  assert.equal(authorize.searchParams.get('scope'), 'user:read:chat user:write:chat');
  assert.ok(authorize.searchParams.get('state'));
  assert.match(response.headers['Set-Cookie'], /HttpOnly; SameSite=Lax/);
  assert.equal(response.headers.Location.includes('unit-test-placeholder-secret'), false);
});

test('callback rejects a mismatched OAuth state before attempting code exchange', async () => {
  const statuses = [];
  const integration = new TwitchIntegration({
    clientId: 'local-client-id',
    clientSecret: 'unit-test-placeholder-secret',
    redirectUri: 'http://localhost:4173/auth/twitch/callback',
    onStatus: (status) => statuses.push(status),
    onCommand() {},
  });
  const response = fakeResponse();
  const request = { headers: { cookie: 'livemystery_oauth_state=expected-state' } };

  await integration.callback(request, response, new URL('http://localhost:4173/auth/twitch/callback?code=not-exchanged&state=wrong-state'));

  assert.equal(response.status, 303);
  assert.equal(response.headers.Location, '/');
  assert.equal(integration.auth, null);
  assert.match(statuses.at(-1).connectionError, /could not be verified/i);
});

test('missing local app configuration does not redirect to Twitch', () => {
  const statuses = [];
  const integration = new TwitchIntegration({ clientId: '', clientSecret: '', redirectUri: '', onStatus: (status) => statuses.push(status), onCommand() {} });
  const response = fakeResponse();
  integration.start(response);

  assert.equal(response.status, 303);
  assert.equal(response.headers.Location, '/');
  assert.equal(response.headers.Location.includes('id.twitch.tv'), false);
  assert.match(statuses[0].connectionError, /TWITCH_CLIENT_ID/);
});
