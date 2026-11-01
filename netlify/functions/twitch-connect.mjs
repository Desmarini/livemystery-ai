import { createPersistence } from '../../server/database/persistence.js';
import { createTwitchOAuthHandlers } from '../../server/twitch/netlify-oauth.js';

const handlers = createTwitchOAuthHandlers({ createPersistence });

export default async function connect(request) {
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
  return handlers.connect();
}

export const config = { path: '/api/twitch/connect', method: 'GET' };
