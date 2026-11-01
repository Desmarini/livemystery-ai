import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE, initialState, publicState, applyCommand, advancePhase, revealVerdict } from '../server/game.js';
import { createNarrator } from '../server/narration.js';

test('investigation reveals clues, rejects invalid rooms and opens voting', () => {
  const state = initialState();
  assert.match(applyCommand(state, 'viewer1', '!investigate unknown').response, /Try/);
  for (const room of ['control', 'archive', 'rooftop']) {
    const result = applyCommand(state, 'viewer1', `!investigate ${room}`);
    assert.ok(result.response.includes(CASE.rooms.find((entry) => entry.id === room).clue));
    advancePhase(state);
  }
  assert.equal(state.discovered.length, 3);
  assert.equal(state.phase, 'voting');
  assert.equal(publicState(state).investigation, 100);
});

test('community votes are one per viewer and a voter can change their vote', () => {
  const state = initialState();
  state.discovered = CASE.evidence.map((entry) => entry.id);
  advancePhase(state);
  applyCommand(state, 'ViewerOne', '!vote A');
  applyCommand(state, 'ViewerTwo', '!vote B');
  applyCommand(state, 'ViewerOne', '!vote C');
  assert.deepEqual(state.votes, { A: 0, B: 1, C: 1 });
  assert.equal(Object.keys(state.voters).length, 2);
  assert.equal(revealVerdict(state).winner, 'B');
  assert.equal(state.phase, 'ended');
});

test('unlocked verdict requires votes and deterministic tie breaks favor A', () => {
  const state = initialState();
  state.discovered = CASE.evidence.map((entry) => entry.id);
  advancePhase(state);
  assert.match(revealVerdict(state).error, /at least one vote/);
  state.votes = { A: 1, B: 1, C: 1 };
  assert.equal(revealVerdict(state).winner, 'A');
});

test('public state omits per-viewer identity data', () => {
  const state = initialState();
  state.voters.secretViewer = 'A';
  const published = publicState(state);
  assert.equal(Object.hasOwn(published, 'voters'), false);
});

test('clue command nudges toward the next undiscovered location', () => {
  const state = initialState();
  assert.match(applyCommand(state, 'viewer', '!clue').response, /control/i);
  applyCommand(state, 'viewer', '!investigate control');
  assert.match(applyCommand(state, 'viewer', '!clue').response, /archive/i);
});

test('control room opens two branching trails and the first choice persists', () => {
  const archiveState = initialState();
  assert.match(applyCommand(archiveState, 'viewer', '!investigate archive').response, /control room is your first lead/i);
  applyCommand(archiveState, 'viewer', '!investigate control');
  applyCommand(archiveState, 'viewer', '!investigate archive');
  applyCommand(archiveState, 'viewer', '!investigate rooftop');
  assert.equal(archiveState.branch, 'archive');

  const rooftopState = initialState();
  applyCommand(rooftopState, 'viewer', '!investigate control');
  applyCommand(rooftopState, 'viewer', '!investigate rooftop');
  assert.equal(rooftopState.branch, 'rooftop');
});

test('optional narrator delegates to a replaceable provider', async () => {
  const narrator = createNarrator(async ({ lead }) => `Found ${lead}.`);
  assert.equal(await narrator.narrate({ lead: 'signal tape' }), 'Found signal tape.');
});
