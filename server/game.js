export const CASE = {
  title: 'The Last Broadcast',
  subtitle: 'A mystery for everyone watching.',
  premise: 'At 11:47 PM, the signal from Northstar Observatory went dark. Three minutes later, a transmission appeared on every screen. Someone inside the station sent it. Your chat has one night to find out who.',
  suspects: [
    { id: 'mara', name: 'Mara Voss', role: 'The radio astronomer', detail: 'She heard a second signal beneath the static.', initial: 'M', color: 'violet' },
    { id: 'eli', name: 'Eli Ward', role: 'The night engineer', detail: 'He had the access codes to the uplink.', initial: 'E', color: 'orange' },
    { id: 'rowan', name: 'Rowan Pike', role: 'The visiting journalist', detail: 'They arrived hours before the blackout.', initial: 'R', color: 'green' },
  ],
  rooms: [
    { id: 'control', title: 'Control room', icon: '⌘', description: 'A warm coffee. A cold terminal. The last log-in was 11:42 PM.', clueId: 'log', clue: 'The uplink was activated with Mara’s credentials—but the override came from the archive terminal.' },
    { id: 'archive', title: 'Signal archive', icon: '◌', description: 'Old recordings stack up beside a tape that was never catalogued.', clueId: 'tape', clue: 'The unmarked tape contains a voice whispering: “The sky remembers what we bury.”' },
    { id: 'rooftop', title: 'Roof antenna', icon: '⌁', description: 'The dish is pointed somewhere the station map doesn’t show.', clueId: 'dish', clue: 'The antenna was aimed at a decommissioned relay—not at the stars.' },
  ],
  evidence: [
    { id: 'log', label: 'Borrowed credentials', number: '01', room: 'Control room' },
    { id: 'tape', label: 'The unmarked recording', number: '02', room: 'Signal archive' },
    { id: 'dish', label: 'An impossible alignment', number: '03', room: 'Roof antenna' },
  ],
  endings: {
    A: { title: 'The signal was a warning', suspect: 'Mara Voss', body: 'Mara uncovered a dormant government relay hidden in the observatory’s archive. She sent a message to bring the truth into the open. The blackout was meant to protect the crew—not deceive them.', verdict: 'The community trusted the stars.', accent: 'teal' },
    B: { title: 'The station was sold', suspect: 'Eli Ward', body: 'Eli rerouted the antenna to the old relay and sold its data to the highest bidder. The transmission was his cover story. The logs told you who had access; the coordinates told you where to look.', verdict: 'The community found the hidden buyer.', accent: 'amber' },
    C: { title: 'The visitor was already here', suspect: 'Rowan Pike', body: 'Rowan arrived to expose the relay before the crew could erase it. The anonymous transmission was a journalist’s deadline. The station went dark because someone finally switched on the lights.', verdict: 'The community followed the story.', accent: 'violet' },
  },
};

export function initialState() {
  return {
    startedAt: new Date().toISOString(),
    phase: 'investigating',
    discovered: [],
    explored: [],
    branch: null,
    votes: { A: 0, B: 0, C: 0 },
    voters: {},
    recentActivity: [],
    commandCount: 0,
    ending: null,
    connected: false,
    channel: '',
    connectionError: '',
    twitchConfigured: false,
    updatedAt: new Date().toISOString(),
  };
}

export function publicState(state) {
  const { voters, ...safe } = state;
  return { ...safe, investigation: Math.round((state.discovered.length / CASE.evidence.length) * 100) };
}

function pushActivity(state, entry) {
  state.recentActivity.unshift({ ...entry, time: new Date().toISOString() });
  state.recentActivity = state.recentActivity.slice(0, 6);
}

export function applyCommand(state, username, rawMessage) {
  const input = String(rawMessage || '').trim();
  if (!input.startsWith('!')) return { state, response: null, diagnostic: { accepted: false, reason: 'not-command' } };
  const [verb = '', ...args] = input.slice(1).split(/\s+/);
  const command = verb.toLowerCase();
  const name = String(username || 'viewer').slice(0, 32);
  state.commandCount += 1;

  if (command === 'clue') {
    const remaining = CASE.evidence.filter((item) => !state.discovered.includes(item.id));
    const branchLead = state.branch === 'rooftop' ? 'dish' : state.branch === 'archive' ? 'tape' : null;
    const next = remaining.find((item) => item.id === branchLead) || remaining[0];
    const response = next ? `Next lead: ${next.room}. Type !investigate ${next.room.split(' ')[0].toLowerCase()} to search.` : 'All three clues are on the board. Chat, it’s time to decide what they mean: !vote A, B, or C.';
    pushActivity(state, { username: name, text: '!clue', kind: 'hint', outcome: next ? `A hint points toward the ${next.room.toLowerCase()}.` : 'Every clue is already uncovered.' });
    return { state, response, diagnostic: { accepted: true, reason: 'clue' } };
  }

  if (command === 'investigate') {
    if (state.phase !== 'investigating') return { state, response: 'The evidence is in. Use !vote A, !vote B, or !vote C to deliver your verdict.', diagnostic: { accepted: false, reason: 'investigation-closed' } };
    const query = args.join(' ').toLowerCase();
    const room = CASE.rooms.find((item) => item.id === query || item.title.toLowerCase().startsWith(query));
    if (!room) return { state, response: 'Try !investigate control, !investigate archive, or !investigate rooftop.', diagnostic: { accepted: false, reason: 'invalid-room' } };
    if (room.id !== 'control' && !state.discovered.includes('log')) return { state, response: 'The control room is your first lead. Search it to uncover the two branching trails.', diagnostic: { accepted: false, reason: 'control-room-required' } };
    if (!state.explored.includes(room.id)) state.explored.push(room.id);
    const clue = CASE.evidence.find((item) => item.id === room.clueId);
    const isNew = !state.discovered.includes(room.clueId);
    if (isNew) state.discovered.push(room.clueId);
    if (room.id !== 'control' && !state.branch) state.branch = room.id;
    const trail = state.branch === 'archive' ? 'archive trail' : 'rooftop trail';
    pushActivity(state, { username: name, text: `!investigate ${room.id}`, kind: 'clue', outcome: isNew ? room.id === 'control' ? 'The control room exposed two possible trails.' : `Chat chose the ${trail}.` : `Revisited the ${room.title.toLowerCase()}.` });
    return { state, response: isNew ? `${clue.room}: ${room.clue}` : `${room.title}: Your team already logged this evidence. Keep searching another room.`, diagnostic: { accepted: true, reason: 'investigate' } };
  }

  if (command === 'vote') {
    const choice = (args[0] || '').toUpperCase();
    if (!['A', 'B', 'C'].includes(choice)) return { state, response: 'Choose a verdict: !vote A, !vote B, or !vote C.', diagnostic: { accepted: false, reason: 'invalid-vote' } };
    if (state.phase !== 'voting') return { state, response: 'The verdict opens once chat has uncovered all three clues.', diagnostic: { accepted: false, reason: 'voting-not-open' } };
    const previous = state.voters[name.toLowerCase()];
    if (previous) state.votes[previous] -= 1;
    state.voters[name.toLowerCase()] = choice;
    state.votes[choice] += 1;
    pushActivity(state, { username: name, text: `!vote ${choice}`, kind: 'vote', outcome: `Voted for ${CASE.endings[choice].suspect}.` });
    return { state, response: `Your vote for ${CASE.endings[choice].suspect} is counted. The whole chat decides the ending.`, diagnostic: { accepted: true, reason: 'vote' } };
  }

  return { state, response: null, diagnostic: { accepted: false, reason: 'unsupported-command' } };
}

export function advancePhase(state) {
  if (state.discovered.length === CASE.evidence.length && state.phase === 'investigating') {
    state.phase = 'voting';
    pushActivity(state, { username: 'LiveMystery', text: 'evidence complete', kind: 'system', outcome: 'All leads uncovered. Community verdict is open.' });
  }
  state.updatedAt = new Date().toISOString();
}

export function revealVerdict(state) {
  if (state.phase !== 'voting') return { error: 'Uncover every clue before revealing the verdict.' };
  const total = Object.values(state.votes).reduce((sum, value) => sum + value, 0);
  if (!total) return { error: 'Chat needs to cast at least one vote before you reveal the verdict.' };
  const order = ['A', 'B', 'C'];
  state.ending = order.reduce((best, choice) => state.votes[choice] > state.votes[best] ? choice : best, 'A');
  state.phase = 'ended';
  pushActivity(state, { username: 'LiveMystery', text: 'verdict revealed', kind: 'system', outcome: `The community picked ${CASE.endings[state.ending].suspect}.` });
  state.updatedAt = new Date().toISOString();
  return { winner: state.ending };
}

