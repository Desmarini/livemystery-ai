const root = document.querySelector('#app');
const overlay = new URLSearchParams(location.search).has('overlay');
const state = { snapshot: null, sse: null, error: '' };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const timeAgo = (iso) => { const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000)); return seconds < 10 ? 'now' : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`; };
async function request(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function subscribeState() {
  state.sse?.close();
  state.sse = new EventSource('/api/events');
  state.sse.onmessage = (event) => { state.snapshot = JSON.parse(event.data); render(); };
}
async function loadInitial() {
  const [snapshot] = await Promise.all([request('/api/state'), request('/api/case')]);
  state.snapshot = snapshot;
  subscribeState();
  render();
}

function renderOverlay() {
  const s = state.snapshot;
  if (!s) return;
  const ending = s.ending ? s.ending : null;
  const caseTitle = 'The Last Broadcast';
  const routeLabel = s.branch === 'archive' ? 'ARCHIVE TRAIL' : s.branch === 'rooftop' ? 'ROOFTOP TRAIL' : 'ROUTE NOT CHOSEN';
  const endingProof = { A: s.branch === 'archive' ? 'The recovered tape shows Mara tried to expose the relay before it was erased.' : 'The antenna log shows Mara redirected the signal to warn the crew.', B: s.branch === 'archive' ? 'The archive records tie Eli to the missing relay logs and a quiet data sale.' : 'The antenna alignment traces the secret relay back to Eli’s console.', C: s.branch === 'archive' ? 'The unmarked tape reveals Rowan had the story before the blackout began.' : 'The rooftop coordinates put Rowan at the relay before the transmission.' };
  const evidence = [
    ['log', '01 · Borrowed credentials'], ['tape', '02 · The unmarked recording'], ['dish', '03 · An impossible alignment'],
  ];
  root.innerHTML = `<main class="overlay-page"><section class="overlay-frame">
    <div class="overlay-mark">◈ &nbsp; LIVE MYSTERY &nbsp; / &nbsp; COMMUNITY INVESTIGATION</div>
    <h1 class="overlay-title">${esc(caseTitle)}</h1>
    <div class="overlay-subtitle">At 11:47 PM, Northstar Observatory went dark. Someone inside the station sent a signal. Chat has one night to find out who.</div>
    <div class="overlay-progress"><div class="progress-top"><span class="progress-label">Collective investigation</span><span class="progress-number">${s.investigation}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${s.investigation}%"></div></div></div>
    <div class="overlay-stats"><span>⌁ ${s.discovered.length} / 3 leads</span><span>✦ ${routeLabel}</span><span>◉ ${Object.values(s.votes).reduce((a,b)=>a+b,0)} verdicts</span>${s.connected ? `<span>● LIVE · ${esc(s.channel)}</span>` : '<span>○ CHAT OFFLINE</span>'}</div>
    <div class="overlay-evidence">${evidence.map(([id, label]) => `<div class="overlay-chip ${s.discovered.includes(id) ? '' : 'missing'}">${s.discovered.includes(id) ? '◆' : '◇'} &nbsp;${label}</div>`).join('')}</div>
    ${s.phase === 'voting' ? `<div class="overlay-votes"><span>!vote A &nbsp; ${s.votes.A}</span><span>!vote B &nbsp; ${s.votes.B}</span><span>!vote C &nbsp; ${s.votes.C}</span></div>` : ''}
    ${ending ? `<div class="overlay-ending"><div class="overlay-suspect">The community chose ${esc(({A:'Mara Voss',B:'Eli Ward',C:'Rowan Pike'})[ending])}</div><div class="overlay-ending-title">${esc(({A:'The signal was a warning',B:'The station was sold',C:'The visitor was already here'})[ending])}</div><p>${esc(({A:'Mara uncovered a dormant government relay hidden in the observatory archive. She sent a message to bring the truth into the open.',B:'Eli rerouted the antenna to the old relay and sold its data. The coordinates told you where to look.',C:'Rowan arrived to expose the relay before the crew could erase it. The blackout was a journalist’s deadline.'})[ending])} ${esc(endingProof[ending] || '')}</p></div>` : ''}
  </section><div class="overlay-attribution">REAL-TIME TWITCH CHAT STORY</div></main>`;
}

function render() {
  if (overlay) return renderOverlay();
  const s = state.snapshot;
  if (!s) return;
  const connected = s.connected;
  const evidence = [
    { id: 'log', title: 'Borrowed credentials', room: 'CONTROL ROOM', number: '01' },
    { id: 'tape', title: 'The unmarked recording', room: 'SIGNAL ARCHIVE', number: '02' },
    { id: 'dish', title: 'An impossible alignment', room: 'ROOF ANTENNA', number: '03' },
  ];
  const labels = { A: 'Mara Voss', B: 'Eli Ward', C: 'Rowan Pike' };
  const routeLabel = s.branch === 'archive' ? 'ARCHIVE TRAIL' : s.branch === 'rooftop' ? 'ROOFTOP TRAIL' : 'TWO TRAILS OPEN AFTER CONTROL ROOM';
  const endingProof = { A: s.branch === 'archive' ? 'The recovered tape shows Mara tried to expose the relay before it was erased.' : 'The antenna log shows Mara redirected the signal to warn the crew.', B: s.branch === 'archive' ? 'The archive records tie Eli to the missing relay logs and a quiet data sale.' : 'The antenna alignment traces the secret relay back to Eli’s console.', C: s.branch === 'archive' ? 'The unmarked tape reveals Rowan had the story before the blackout began.' : 'The rooftop coordinates put Rowan at the relay before the transmission.' };
  const totalVotes = Object.values(s.votes).reduce((sum, n) => sum + n, 0);
  root.innerHTML = `<div class="shell">
    <header class="topbar"><a class="brand" href="/"><span class="brand-mark">◈</span><span class="brand-name">LIVE<span>MYSTERY</span></span></a><div class="top-actions"><span class="edition">A CHAT-POWERED STORY ENGINE</span><div class="connection-pill"><span class="dot ${connected ? 'connected' : ''}"></span>${connected ? `LIVE · ${esc(s.channel || 'TWITCH')}` : 'NOT CONNECTED'}</div></div></header>
    <main class="main"><div class="page-intro"><div><div class="eyebrow">THE INVESTIGATION ROOM &nbsp; / &nbsp; CASE 001</div><h1>Good evening, detective.</h1><p>Every clue comes from chat. Every ending is decided together.</p></div><button class="primary-button" id="overlayLink">↗ &nbsp; Open OBS overlay</button></div>
      <div class="layout"><section class="left-column">
        <article class="card case-card"><div class="case-kicker"><i></i> TONIGHT’S CASE &nbsp; · &nbsp; MYSTERY / SCI-FI</div><h2 class="case-title">The Last Broadcast</h2><p class="case-copy">At 11:47 PM, the signal from Northstar Observatory went dark. Three minutes later, a transmission appeared on every screen. Someone inside the station sent it. Your chat has one night to find out who.</p><div class="case-meta"><span>SETTING <b class="meta-value">Northstar Observatory</b></span><span>SUSPECTS <b class="meta-value">03</b></span><span>ENDINGS <b class="meta-value">03</b></span><span>CHAT’S TRAIL <b class="meta-value">${routeLabel}</b></span></div></article>
        <article class="card progress-card"><div class="progress-top"><div><div class="section-heading"><h2>Community investigation</h2><span class="phase-pill">${s.phase === 'investigating' ? 'ACT I · INVESTIGATION' : s.phase === 'voting' ? 'ACT II · VERDICT' : 'CASE CLOSED'}</span></div><div class="progress-label">The truth is hiding in the details.</div></div><div class="progress-number">${s.investigation}%</div></div><div class="progress-track"><div class="progress-fill" style="width:${s.investigation}%"></div></div><div class="progress-caption">${s.discovered.length} OF 3 EVIDENCE PIECES FOUND &nbsp; · &nbsp; ${s.commandCount} CHAT COMMANDS RECEIVED</div></article>
        <article class="card evidence-card"><div class="section-heading"><h2>Evidence board</h2><span class="section-count">${s.discovered.length} / 3 documented</span></div><div class="evidence-grid">${evidence.map(item => `<div class="evidence ${s.discovered.includes(item.id) ? 'evidence-found' : ''}"><span class="evidence-number">FILE ${item.number}</span><span class="evidence-icon">${s.discovered.includes(item.id) ? '◆' : '◇'}</span><div class="evidence-title">${s.discovered.includes(item.id) ? item.title : 'Awaiting discovery'}</div><div class="evidence-room">${s.discovered.includes(item.id) ? item.room : 'HIDDEN LEAD'}</div></div>`).join('')}</div></article>
        <article class="card suspects-card"><div class="section-heading"><h2>Persons of interest</h2><span class="section-count">NO ONE CLEARED</span></div><div class="suspect-grid"><div class="suspect"><span class="avatar violet">M</span><div><div class="suspect-name">Mara Voss</div><div class="suspect-role">RADIO ASTRONOMER</div></div></div><div class="suspect"><span class="avatar orange">E</span><div><div class="suspect-name">Eli Ward</div><div class="suspect-role">NIGHT ENGINEER</div></div></div><div class="suspect"><span class="avatar green">R</span><div><div class="suspect-name">Rowan Pike</div><div class="suspect-role">VISITING JOURNALIST</div></div></div></div></article>
        ${s.ending ? `<article class="card end-card"><div class="eyebrow">COMMUNITY VERDICT &nbsp; · &nbsp; ${routeLabel} &nbsp; · &nbsp; SUSPECT ${s.ending}</div><h2 class="end-title">${esc(({A:'The signal was a warning',B:'The station was sold',C:'The visitor was already here'})[s.ending])}</h2><div class="end-copy">${esc(({A:'Mara uncovered a dormant government relay and sent a message to bring the truth into the open.',B:'Eli rerouted the antenna to the old relay and sold its data to the highest bidder.',C:'Rowan came to expose the relay before it could be erased. The blackout was a journalist’s deadline.'})[s.ending])} ${esc(endingProof[s.ending] || '')}</div></article>` : ''}
      </section><aside class="right-column">
        <article class="card twitch-card"><div class="twitch-heading"><div class="twitch-label"><span class="twitch-icon">t</span><div><h2>Twitch connection</h2><span class="subtle-label">${connected ? `Connected as @${esc(s.channel)}` : 'REAL CHAT · EVENTSUB'}</span></div></div><span class="dot ${connected ? 'connected' : ''}"></span></div>
          ${connected ? `<p class="twitch-state">Listening to <b>${esc(s.channel)}’s</b> live chat. Twitch OAuth and chat run on the local Node server.</p>${s.connectionError ? `<div class="error-text">${esc(s.connectionError)}</div>` : ''}<button class="connect-button" id="disconnect">Disconnect from Twitch</button>` : `<p class="twitch-state">Connect your channel to listen for viewer commands and reveal clues live.</p><a class="connect-button ${s.twitchConfigured ? '' : 'disabled'}" href="${s.twitchConfigured ? '/auth/twitch' : '#'}" ${s.twitchConfigured ? '' : 'aria-disabled="true"'}>Connect with Twitch</a><a class="setup-link" href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">↗ &nbsp; Open the Twitch Developer Console</a>${s.connectionError ? `<div class="error-text">${esc(s.connectionError)}</div>` : ''}${state.error ? `<div class="error-text">${esc(state.error)}</div>` : ''}${s.twitchConfigured ? '<div class="demo-safe">◇ &nbsp;Tokens stay on the local Node server, never in browser JavaScript.</div>' : '<div class="error-text">Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and TWITCH_REDIRECT_URI in .env, then restart.</div>'}`}
        </article>
        <article class="card command-card"><div class="section-heading"><h2>Chat commands</h2><span class="section-count">LIVE INPUTS</span></div><div class="command-list"><div class="command-row"><span class="command">!investigate [room]</span><span class="command-desc">Search for clues</span></div><div class="command-row"><span class="command">!clue</span><span class="command-desc">Get a nudge</span></div><div class="command-row"><span class="command">!vote A / B / C</span><span class="command-desc">Cast a verdict</span></div></div></article>
        <article class="card votes-card"><div class="section-heading"><h2>Community verdict</h2><span class="section-count">${totalVotes} ${totalVotes === 1 ? 'VOTE' : 'VOTES'}</span></div>${['A','B','C'].map(letter => `<div class="vote-option"><span class="vote-letter">${letter}</span><span class="vote-copy">${labels[letter]}</span><span class="vote-count">${s.votes[letter]}</span><span class="vote-bar"><span class="vote-fill" style="display:block;width:${totalVotes ? (s.votes[letter]/totalVotes*100) : 0}%"></span></span></div>`).join('')}<div class="vote-footer"><span class="vote-total">${s.phase === 'investigating' ? 'VERDICT OPENS AFTER ALL CLUES' : s.phase === 'ended' ? 'CASE CLOSED' : 'THE CHAT DECIDES'}</span>${s.phase === 'voting' ? '<button class="quiet-button reveal-button" id="reveal">Reveal ending ↗</button>' : ''}</div></article>
        <article class="card activity-card"><div class="section-heading"><h2>Live activity</h2><span class="section-count">${connected ? 'EVENTSUB' : 'WAITING FOR CHAT'}</span></div><div class="activity-list">${s.recentActivity.length ? s.recentActivity.slice(0,5).map(item => `<div class="activity-item"><span class="activity-dot ${esc(item.kind)}"></span><span class="activity-text"><b>${esc(item.username)}</b> ${esc(item.outcome)}</span><span class="activity-time">${timeAgo(item.time)}</span></div>`).join('') : '<div class="empty-activity">Live chat activity will appear here.</div>'}</div></article>
        <button class="quiet-button" id="reset" style="font-size:10px">↺ &nbsp; Start a new investigation</button>
      </aside></div><div class="bottom-note">A SHARED STORY, WRITTEN BY CHAT &nbsp; · &nbsp; BUILT FOR TWITCH</div></main></div>`;
  document.querySelector('#overlayLink')?.addEventListener('click', () => window.open('/?overlay=1', '_blank', 'noopener'));
  document.querySelector('#disconnect')?.addEventListener('click', disconnectTwitch);
  document.querySelector('#reveal')?.addEventListener('click', async () => { try { await request('/api/reveal', {}); } catch (e) { state.error = e.message; render(); } });
  document.querySelector('#reset')?.addEventListener('click', async () => { if (confirm('Start a new investigation? This clears all clues and votes for everyone.')) await request('/api/reset', {}); });
}
function disconnectTwitch() {
  request('/auth/twitch/logout', {}).catch((error) => { state.error = error.message; render(); });
}

loadInitial().catch((error) => { state.error = error.message; root.innerHTML = `<main class="main"><div class="error-text">${esc(error.message)}</div></main>`; });
