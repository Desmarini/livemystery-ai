import { createPersistence } from '../../server/database/persistence.js';
import { createTwitchOAuthHandlers } from '../../server/twitch/netlify-oauth.js';

const handlers = createTwitchOAuthHandlers({ createPersistence });

export default async function callback(request) {
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
  return handlers.callback(request);
}

export const config = { path: '/api/twitch/callback', method: 'GET' };
