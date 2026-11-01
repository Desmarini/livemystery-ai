import { randomBytes } from 'node:crypto';

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const CHAT_SCOPES = ['user:read:chat', 'user:write:chat'];
const COOKIE_STATE = 'livemystery_oauth_state';
const COOKIE_SESSION = 'livemystery_session';

function diagnostic(event, details = {}) {
  const fields = Object.entries(details).map(([key, value]) => `${key}=${String(value)}`);
  console.info(`[Twitch EventSub] ${event}${fields.length ? ` ${fields.join(' ')}` : ''}`);
}

function parseCookies(request) {
  const cookies = new Map();
  for (const piece of (request.headers.cookie || '').split(';')) {
    const separator = piece.indexOf('=');
    if (separator < 0) continue;
    try { cookies.set(piece.slice(0, separator).trim(), decodeURIComponent(piece.slice(separator + 1).trim())); }
    catch { continue; }
  }
  return cookies;
}

function clearCookie(name, path) {
  return `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function redirect(response, location, cookies = []) {
  response.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': cookies });
  response.end();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TwitchIntegration {
  constructor({ clientId, clientSecret, redirectUri, onStatus, onCommand }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.onStatus = onStatus;
    this.onCommand = onCommand;
    this.auth = null;
    this.lastCommands = new Map();
    this.replyQueue = [];
    this.sendingReplies = false;
    this.lastReplyAt = 0;
  }

  get configured() {
    const isPlaceholder = (value) => String(value || '').startsWith('replace_with_');
    return Boolean(this.clientId && this.clientSecret && this.redirectUri) && !isPlaceholder(this.clientId) && !isPlaceholder(this.clientSecret);
  }

  start(response) {
    if (!this.configured) {
      this.onStatus({ connected: false, channel: '', connectionError: 'Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and TWITCH_REDIRECT_URI in .env, then restart LiveMystery.' });
      return redirect(response, '/');
    }
    const oauthState = randomBytes(32).toString('hex');
    const authorize = new URL('https://id.twitch.tv/oauth2/authorize');
    authorize.searchParams.set('client_id', this.clientId);
    authorize.searchParams.set('redirect_uri', this.redirectUri);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', CHAT_SCOPES.join(' '));
    authorize.searchParams.set('state', oauthState);
    response.writeHead(302, {
      Location: authorize.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': `${COOKIE_STATE}=${oauthState}; Path=/auth/twitch; HttpOnly; SameSite=Lax; Max-Age=600`,
    });
    response.end();
  }

  async callback(request, response, url) {
    const cookies = parseCookies(request);
    const expectedState = cookies.get(COOKIE_STATE);
    const returnedState = url.searchParams.get('state');
    const stateCookie = clearCookie(COOKIE_STATE, '/auth/twitch');
    if (!expectedState || !returnedState || expectedState !== returnedState) {
      this.onStatus({ connected: false, channel: '', connectionError: 'Twitch sign-in could not be verified. Start Connect with Twitch again.' });
      return redirect(response, '/', [stateCookie]);
    }
    if (url.searchParams.has('error')) {
      this.onStatus({ connected: false, channel: '', connectionError: 'Twitch authorization was canceled or declined.' });
      return redirect(response, '/', [stateCookie]);
    }
    const code = url.searchParams.get('code');
    if (!code) {
      this.onStatus({ connected: false, channel: '', connectionError: 'Twitch did not return an authorization code. Try connecting again.' });
      return redirect(response, '/', [stateCookie]);
    }

    try {
      const token = await this.exchangeCode(code);
      const identity = await this.validateToken(token.access_token);
      const sessionId = randomBytes(32).toString('hex');
      this.stop();
      this.auth = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + Math.max(1, Math.min(token.expires_in, identity.expires_in)) * 1000,
        user: { id: identity.user_id, login: identity.login },
        sessionId,
        socket: null,
        refreshTimer: null,
        validationTimer: null,
        reconnectTimer: null,
        reconnectAttempts: 0,
        stopped: false,
      };
      this.onStatus({ connected: false, channel: identity.login, connectionError: '' });
      this.scheduleTokenTasks(this.auth);
      this.connectEventSub(this.auth);
      return redirect(response, '/', [stateCookie, `${COOKIE_SESSION}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`]);
    } catch {
      this.onStatus({ connected: false, channel: '', connectionError: 'Twitch sign-in failed. Check the Client ID, secret, callback URL, and requested scopes, then try again.' });
      return redirect(response, '/', [stateCookie, clearCookie(COOKIE_SESSION, '/')]);
    }
  }

  async logout(request, response) {
    const cookies = parseCookies(request);
    const sessionId = cookies.get(COOKIE_SESSION);
    if (!this.auth || !sessionId || sessionId !== this.auth.sessionId) {
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(JSON.stringify({ error: 'No active LiveMystery Twitch session.' }));
    }
    this.stop();
    this.onStatus({ connected: false, channel: '', connectionError: '' });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': clearCookie(COOKIE_SESSION, '/') });
    response.end(JSON.stringify({ ok: true }));
  }

  async exchangeCode(code) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
    });
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error('Twitch code exchange failed.');
    const token = await response.json();
    if (!token.access_token || !token.refresh_token || !Number.isFinite(token.expires_in)) throw new Error('Twitch returned an incomplete token response.');
    return token;
  }

  async validateToken(accessToken) {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${accessToken}` } });
    if (!response.ok) throw new Error('Twitch token validation failed.');
    const identity = await response.json();
    if (identity.client_id !== this.clientId || !identity.user_id || !identity.login) throw new Error('Twitch returned a token for a different app or no user.');
    if (CHAT_SCOPES.some((scope) => !identity.scopes?.includes(scope))) throw new Error('Twitch authorization is missing required chat scopes.');
    return identity;
  }

  scheduleTokenTasks(auth) {
    clearTimeout(auth.refreshTimer);
    clearInterval(auth.validationTimer);
    const refreshDelay = Math.max(10_000, auth.expiresAt - Date.now() - 60_000);
    auth.refreshTimer = setTimeout(() => this.refreshAccessToken(auth), refreshDelay);
    auth.refreshTimer.unref?.();
    auth.validationTimer = setInterval(() => this.validateSession(auth), 60 * 60 * 1000);
    auth.validationTimer.unref?.();
  }

  async refreshAccessToken(auth) {
    if (this.auth !== auth || auth.stopped) return;
    try {
      const body = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
      });
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!response.ok) throw new Error('Twitch token refresh failed.');
      const token = await response.json();
      if (!token.access_token || !Number.isFinite(token.expires_in)) throw new Error('Twitch returned an incomplete refresh response.');
      auth.accessToken = token.access_token;
      auth.refreshToken = token.refresh_token || auth.refreshToken;
      const identity = await this.validateToken(auth.accessToken);
      auth.expiresAt = Date.now() + Math.min(token.expires_in, identity.expires_in) * 1000;
      this.scheduleTokenTasks(auth);
      this.onStatus({ connected: false, channel: auth.user.login, connectionError: '' });
      this.connectEventSub(auth);
    } catch {
      if (this.auth === auth) {
        this.stop();
        this.onStatus({ connected: false, channel: '', connectionError: 'Twitch authorization expired or was revoked. Connect again to resume chat.' });
      }
    }
  }

  async validateSession(auth) {
    if (this.auth !== auth || auth.stopped) return;
    try {
      const identity = await this.validateToken(auth.accessToken);
      auth.expiresAt = Date.now() + identity.expires_in * 1000;
      if (identity.user_id !== auth.user.id) throw new Error('Twitch user changed.');
    } catch {
      if (this.auth === auth) await this.refreshAccessToken(auth);
    }
  }

  connectEventSub(auth, url = EVENTSUB_URL, transferred = false) {
    if (this.auth !== auth || auth.stopped) return;
    if (typeof WebSocket !== 'function') {
      this.onStatus({ connected: false, channel: auth.user.login, connectionError: 'This Node.js runtime does not provide WebSocket. Use Node.js 22 or later.' });
      return;
    }
    let socket;
    try {
      socket = new WebSocket(url);
      diagnostic('websocket-connecting', { reconnect: transferred });
    } catch {
      diagnostic('websocket-create-failed');
      this.scheduleReconnect(auth);
      return;
    }
    const previousSocket = auth.socket;
    auth.socket = socket;
    socket.addEventListener('open', () => {
      if (this.auth === auth && auth.socket === socket) diagnostic('websocket-connected', { reconnect: transferred });
    });
    socket.addEventListener('message', (message) => {
      this.handleEventSubMessage(auth, socket, message.data, transferred, previousSocket).catch(() => {
        this.onStatus({ connected: false, channel: auth.user.login, connectionError: 'Twitch chat setup failed. Check the chat scopes and reconnect.' });
        try { socket.close(); } catch {}
      });
    });
    socket.addEventListener('error', () => {
      diagnostic('websocket-error');
      if (this.auth === auth && auth.socket === socket) this.onStatus({ connected: false, channel: auth.user.login, connectionError: 'Could not reach Twitch EventSub. Check the network and reconnect.' });
    });
    socket.addEventListener('close', () => {
      diagnostic('websocket-closed');
      if (this.auth !== auth || auth.stopped || auth.socket !== socket) return;
      this.onStatus({ connected: false, channel: auth.user.login, connectionError: 'Twitch EventSub disconnected. Reconnecting…' });
      this.scheduleReconnect(auth);
    });
  }

  async handleEventSubMessage(auth, socket, rawData, transferred, previousSocket) {
    if (this.auth !== auth || auth.stopped) return;
    const frame = JSON.parse(String(rawData));
    const type = frame.metadata?.message_type;
    if (type === 'session_welcome') {
      diagnostic('session-welcome', { reconnect: transferred });
      if (!transferred) await this.createChatSubscription(auth, frame.payload.session.id);
      auth.reconnectAttempts = 0;
      this.onStatus({ connected: true, channel: auth.user.login, connectionError: '' });
      if (previousSocket && previousSocket !== socket) {
        try { previousSocket.close(); } catch {}
      }
    } else if (type === 'notification' && frame.payload?.subscription?.type === 'channel.chat.message') {
      diagnostic('notification', { type: frame.payload.subscription.type });
      const event = frame.payload.event;
      await this.handleChatMessage(auth, event.chatter_user_name, event.message?.text || '');
    } else if (type === 'notification') {
      diagnostic('notification', { type: frame.payload?.subscription?.type || 'unknown' });
    } else if (type === 'session_reconnect') {
      diagnostic('session-reconnect');
      const reconnectUrl = frame.payload?.session?.reconnect_url;
      if (reconnectUrl) this.connectEventSub(auth, reconnectUrl, true);
    } else if (type === 'revocation') {
      diagnostic('subscription-revoked', { type: frame.payload?.subscription?.type || 'unknown' });
      this.onStatus({ connected: false, channel: auth.user.login, connectionError: 'Twitch revoked the chat subscription. Reconnect and approve the required chat scopes.' });
      auth.socket = null;
      try { socket.close(); } catch {}
    }
  }

  async createChatSubscription(auth, sessionId) {
    const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: { 'Client-ID': this.clientId, Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'channel.chat.message',
        version: '1',
        condition: { broadcaster_user_id: auth.user.id, user_id: auth.user.id },
        transport: { method: 'websocket', session_id: sessionId },
      }),
    });
    const subscription = await response.json().catch(() => null);
    const subscriptionId = subscription?.data?.[0]?.id;
    diagnostic('subscription-result', { type: 'channel.chat.message', status: response.status, ...(subscriptionId ? { subscriptionId } : {}) });
    if (!response.ok) throw new Error(`Twitch rejected the chat subscription (${response.status}).`);
  }

  async handleChatMessage(auth, username, rawMessage) {
    if (this.auth !== auth || auth.stopped) return;
    const message = String(rawMessage).trim();
    if (!message.startsWith('!')) {
      diagnostic('chat-message-ignored', { reason: 'not-command' });
      return;
    }
    const login = String(username || 'viewer').toLowerCase();
    const now = Date.now();
    if (now - (this.lastCommands.get(login) || 0) < 1800) {
      diagnostic('chat-message-ignored', { reason: 'cooldown' });
      return;
    }
    this.lastCommands.set(login, now);
    const result = this.onCommand(username, message, auth.user.login);
    const outcome = result?.diagnostic;
    diagnostic(outcome?.accepted ? 'chat-message-accepted' : 'chat-message-ignored', { reason: outcome?.reason || 'no-game-result' });
    if (result?.response) {
      this.replyQueue.push({ auth, text: result.response });
      this.drainReplies().catch(() => {});
    }
  }

  async drainReplies() {
    if (this.sendingReplies) return;
    this.sendingReplies = true;
    try {
      while (this.replyQueue.length) {
        const item = this.replyQueue.shift();
        if (this.auth !== item.auth || item.auth.stopped) continue;
        await delay(Math.max(0, 1200 - (Date.now() - this.lastReplyAt)));
        if (this.auth !== item.auth || item.auth.stopped) continue;
        const response = await fetch('https://api.twitch.tv/helix/chat/messages', {
          method: 'POST',
          headers: { 'Client-ID': this.clientId, Authorization: `Bearer ${item.auth.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ broadcaster_id: item.auth.user.id, sender_id: item.auth.user.id, message: item.text.slice(0, 500) }),
        });
        this.lastReplyAt = Date.now();
        if (this.auth !== item.auth) continue;
        if (!response.ok) {
          this.onStatus({ connected: true, channel: item.auth.user.login, connectionError: `Twitch could not send a chat reply (HTTP ${response.status}).` });
        } else {
          const result = await response.json();
          if (result.data?.[0]?.is_sent === false) this.onStatus({ connected: true, channel: item.auth.user.login, connectionError: 'Twitch did not send a chat reply. Check chat settings and Automod.' });
        }
      }
    } finally {
      this.sendingReplies = false;
      if (this.replyQueue.length) this.drainReplies().catch(() => {});
    }
  }

  scheduleReconnect(auth) {
    if (this.auth !== auth || auth.stopped || auth.reconnectTimer) return;
    const wait = Math.min(30_000, 1_000 * (2 ** Math.min(auth.reconnectAttempts, 5)));
    auth.reconnectAttempts += 1;
    auth.reconnectTimer = setTimeout(() => {
      auth.reconnectTimer = null;
      this.connectEventSub(auth);
    }, wait);
    auth.reconnectTimer.unref?.();
  }

  stop() {
    const auth = this.auth;
    if (!auth) return;
    auth.stopped = true;
    clearTimeout(auth.refreshTimer);
    clearInterval(auth.validationTimer);
    clearTimeout(auth.reconnectTimer);
    try { auth.socket?.close(); } catch {}
    this.auth = null;
    this.replyQueue = this.replyQueue.filter((item) => item.auth !== auth);
  }
}
