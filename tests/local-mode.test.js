import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('local Node server, EventSub WebSocket path, and OBS overlay remain available', async () => {
  const [server, twitch, client] = await Promise.all([
    readProjectFile('server/index.js'),
    readProjectFile('server/twitch.js'),
    readProjectFile('public/app.js'),
  ]);

  assert.match(server, /process\.env\.PORT \|\| 4173/);
  assert.match(server, /server\.listen\(port, '0\.0\.0\.0'/);
  assert.match(twitch, /wss:\/\/eventsub\.wss\.twitch\.tv\/ws/);
  assert.match(twitch, /transport: \{ method: 'websocket', session_id: sessionId \}/);
  assert.match(client, /new URLSearchParams\(location\.search\)\.has\('overlay'\)/);
  assert.match(client, /new EventSource\('\/api\/events'\)/);
});
