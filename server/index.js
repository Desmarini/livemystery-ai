import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASE, initialState, publicState, applyCommand, advancePhase, revealVerdict } from './game.js';
import { TwitchIntegration } from './twitch.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const envFile = join(projectRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const root = join(projectRoot, 'public');
const port = Number(process.env.PORT || 4173);
const redirectUri = process.env.TWITCH_REDIRECT_URI || `http://localhost:${port}/auth/twitch/callback`;
const state = initialState();
const clients = new Set();
const twitch = new TwitchIntegration({
  clientId: process.env.TWITCH_CLIENT_ID,
  clientSecret: process.env.TWITCH_CLIENT_SECRET,
  redirectUri,
  onStatus: ({ connected, channel, connectionError }) => {
    state.connected = connected;
    state.channel = channel || '';
    state.connectionError = connectionError || '';
    state.updatedAt = new Date().toISOString();
    broadcast();
  },
  onCommand: (username, message, channel) => {
    const result = applyCommand(state, username, message);
    state.channel = channel;
    advancePhase(state);
    broadcast();
    return result;
  },
});
state.twitchConfigured = twitch.configured;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function broadcast() {
  const frame = `data: ${JSON.stringify(publicState(state))}\n\n`;
  for (const client of clients) client.write(frame);
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && (url.pathname.startsWith('/api/') || url.pathname === '/auth/twitch/logout')) {
    const origin = req.headers.origin;
    const forwardedProtocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const requestOrigin = `${forwardedProtocol}://${req.headers.host}`;
    if (origin && origin !== requestOrigin) return json(res, 403, { error: 'Requests must come from this LiveMystery page.' });
  }
  if (req.method === 'GET' && url.pathname === '/auth/twitch') return twitch.start(res);
  if (req.method === 'GET' && url.pathname === '/auth/twitch/callback') return twitch.callback(req, res, url);
  if (req.method === 'POST' && url.pathname === '/auth/twitch/logout') return twitch.logout(req, res);
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState(state));
  if (req.method === 'GET' && url.pathname === '/api/case') return json(res, 200, CASE);
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(publicState(state))}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/reset') {
    const fresh = initialState();
    Object.assign(state, fresh);
    broadcast();
    return json(res, 200, publicState(state));
  }
  if (req.method === 'POST' && url.pathname === '/api/reveal') {
    const result = revealVerdict(state);
    if (result.error) return json(res, 409, { error: result.error });
    broadcast();
    return json(res, 200, publicState(state));
  }

  let requested;
  try { requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); }
  catch { requested = ''; }
  const file = resolve(root, requested);
  if ((file !== root && !file.startsWith(`${root}${sep}`)) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`LiveMystery AI is running at http://localhost:${server.address().port}`);
  console.log(twitch.configured ? 'Twitch OAuth is configured.' : 'Twitch OAuth is not configured; add the required values to .env and restart.');
  console.log('The server accepts network traffic on all interfaces; Twitch tokens remain in server memory.');
});
