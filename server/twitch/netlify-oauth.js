import { createHash, randomBytes } from 'node:crypto';

export const APP_SESSION_COOKIE_NAME = 'livemystery_session';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const APP_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TWITCH_SCOPES = ['chat:read', 'chat:edit'];

function hashOpaqueValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireOAuthConfig(environment) {
  const clientId = environment.TWITCH_CLIENT_ID;
  const clientSecret = environment.TWITCH_CLIENT_SECRET;
  const redirectUri = environment.TWITCH_REDIRECT_URI;
  if (![clientId, clientSecret, redirectUri].every((value) => typeof value === 'string' && value.trim())) {
    throw new Error('Twitch OAuth configuration is incomplete.');
  }
  let parsedRedirect;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new Error('Twitch OAuth redirect URI is invalid.');
  }
  if (parsedRedirect.protocol !== 'https:') throw new Error('Twitch OAuth redirect URI must use HTTPS.');
  return { clientId, clientSecret, redirectUri };
}

async function requirePostgresPersistence(createPersistence, environment) {
  const persistence = await createPersistence({ environment });
  if (persistence.mode !== 'postgres' || !persistence.repositories) {
    throw new Error('Persistent OAuth storage is unavailable.');
  }
  return persistence.repositories;
}

function jsonResponse(status, message) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function sessionCookie(sessionId, expiresAt) {
  return `${APP_SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(APP_SESSION_TTL_MS / 1000)}; Expires=${expiresAt.toUTCString()}`;
}

function getTokenPayload(payload) {
  if (!payload || typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string'
    || !Number.isSafeInteger(payload.expires_in) || payload.expires_in <= 0) {
    throw new Error('Twitch token response is incomplete.');
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    grantedScopes: Array.isArray(payload.scope) ? payload.scope.filter((scope) => typeof scope === 'string') : [],
  };
}

function getBroadcaster(payload) {
  const broadcaster = payload?.data?.[0];
  if (!broadcaster || typeof broadcaster.id !== 'string' || typeof broadcaster.login !== 'string') {
    throw new Error('Twitch broadcaster identity is unavailable.');
  }
  return { broadcasterUserId: broadcaster.id, broadcasterLogin: broadcaster.login };
}

export function createTwitchOAuthHandlers({ createPersistence, fetchImpl = fetch, environment = process.env, now = () => new Date(), randomBytesImpl = randomBytes } = {}) {
  if (typeof createPersistence !== 'function') throw new TypeError('A persistence factory is required.');

  return {
    async connect() {
      try {
        const config = requireOAuthConfig(environment);
        const repositories = await requirePostgresPersistence(createPersistence, environment);
        const state = randomBytesImpl(32).toString('base64url');
        const created = await repositories.oauthSessions.create({
          stateHash: hashOpaqueValue(state),
          redirectUri: config.redirectUri,
          expiresAt: new Date(now().getTime() + OAUTH_STATE_TTL_MS).toISOString(),
        });
        if (!created) throw new Error('OAuth state collision.');

        const authorizationUrl = new URL('https://id.twitch.tv/oauth2/authorize');
        authorizationUrl.searchParams.set('client_id', config.clientId);
        authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
        authorizationUrl.searchParams.set('response_type', 'code');
        authorizationUrl.searchParams.set('scope', TWITCH_SCOPES.join(' '));
        authorizationUrl.searchParams.set('state', state);
        return Response.redirect(authorizationUrl, 302);
      } catch {
        return jsonResponse(503, 'OAuth service is unavailable.');
      }
    },

    async callback(request) {
      const requestUrl = new URL(request.url);
      if (requestUrl.searchParams.has('error')) return jsonResponse(400, 'OAuth authorization was not completed.');
      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');
      if (!code || !state) return jsonResponse(400, 'OAuth callback is invalid.');

      try {
        const config = requireOAuthConfig(environment);
        const repositories = await requirePostgresPersistence(createPersistence, environment);
        const consumed = await repositories.oauthSessions.consume(hashOpaqueValue(state));
        if (!consumed || consumed.redirect_uri !== config.redirectUri) return jsonResponse(400, 'OAuth state is invalid or expired.');

        const tokenResponse = await fetchImpl('https://id.twitch.tv/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: config.redirectUri,
          }),
        });
        if (!tokenResponse.ok) throw new Error('Twitch token exchange failed.');
        const token = getTokenPayload(await tokenResponse.json());

        const identityResponse = await fetchImpl('https://api.twitch.tv/helix/users', {
          headers: { 'Client-Id': config.clientId, Authorization: `Bearer ${token.accessToken}` },
        });
        if (!identityResponse.ok) throw new Error('Twitch identity lookup failed.');
        const broadcaster = getBroadcaster(await identityResponse.json());

        await repositories.twitchAuthorizations.save({
          ...broadcaster,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          accessTokenExpiresAt: new Date(now().getTime() + token.expiresIn * 1000).toISOString(),
          grantedScopes: token.grantedScopes,
        });

        const sessionId = randomBytesImpl(32).toString('base64url');
        const sessionExpiresAt = new Date(now().getTime() + APP_SESSION_TTL_MS);
        const session = await repositories.appSessions.create({
          sessionIdHash: hashOpaqueValue(sessionId),
          broadcasterUserId: broadcaster.broadcasterUserId,
          expiresAt: sessionExpiresAt.toISOString(),
        });
        if (!session) throw new Error('Session collision.');

        return new Response(null, {
          status: 302,
          headers: {
            Location: new URL('/', config.redirectUri).toString(),
            'Set-Cookie': sessionCookie(sessionId, sessionExpiresAt),
            'Cache-Control': 'no-store',
          },
        });
      } catch {
        return jsonResponse(502, 'OAuth callback could not be completed.');
      }
    },
  };
}
