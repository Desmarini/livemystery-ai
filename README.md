# LiveMystery AI

**Every message moves the story.** LiveMystery is a real-time mystery game for Twitch streamers. Viewers investigate an original sci-fi case through real Twitch chat commands, uncover evidence together, and vote on one of three endings.

**Hackathon timing:** the official [schedule](https://twitchcon-codex.devpost.com/details/dates) lists submissions from October 23, 2026 at 10:00 a.m. PDT through November 2, 2026 at 2:00 p.m. PST. This project was built October 29, 2026, within that listed submission window.

## What’s in the MVP

- A responsive investigation dashboard, live activity feed, evidence board, branching investigation, vote totals, and three authored endings.
- A transparent OBS Browser Source overlay that receives the current story state from the local app.
- The real Twitch integration path is implemented with OAuth, EventSub WebSocket chat subscriptions, and Twitch Helix chat replies. **It still needs a live Twitch app/account test**; the app does not simulate Twitch connectivity.
- An in-memory state relay. The shared game runs as long as the Node process is running; it resets when the process stops.
- Deterministic narration, with a replaceable `createNarrator(provider)` interface in `server/narration.js`. The MVP makes no AI calls or paid API requests.

## Prerequisites and cost

- Node.js 22+ (tested with Node 24) and npm.
- A Twitch account and a free Twitch developer application.
- A network connection for Twitch OAuth/EventSub and (optionally) Google Fonts.
- OBS Studio if you want to show the overlay on stream.

The app and local demo cost $0. There are no npm dependencies, paid AI services, cloud services, or hosting subscriptions. The Client ID and Client Secret are read by Node from `.env`; the secret and OAuth access/refresh tokens never enter browser JavaScript, app state, logs, or Git. Tokens are held in server memory only and are cleared when the Node process stops. `.env` is ignored by Git.

## Run locally

```sh
npm start
```

Create `.env` from the safe placeholder file, fill it locally, then start the app:

```powershell
Copy-Item .env.example .env
# Edit .env locally and replace each placeholder with your Twitch app value.
npm start
```

Open [http://localhost:4173](http://localhost:4173). The server binds to `127.0.0.1` only. Never send the `.env` contents to anyone or commit the file.

## Register a Twitch application

1. Sign in to the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and register a `LiveMystery Local` application.
2. Choose **Confidential** as the Client Type. Set the OAuth Redirect URL to **exactly** `http://localhost:4173/auth/twitch/callback`.
3. Choose the **Chat Bot** category if available. Twitch requires a category selection, but it does not determine the OAuth flow.
4. Open the app’s **Manage** page and copy its Client ID. Create a Client Secret there. Put both values into the matching fields in `.env` on your computer only. Do not put either value in chat, the UI, source code, or a committed file.
5. Set `TWITCH_REDIRECT_URI` in `.env` to the exact URL above, save the file, and run `npm start` (restart Node if it was already running).
6. Select **Connect with Twitch** in the dashboard. Twitch returns an authorization code to the Node callback. Node verifies the OAuth state cookie, exchanges the code server-to-server, validates the token, then opens EventSub. Approve `user:read:chat` and `user:write:chat`. Keep Node running; the server holds tokens in memory.
7. Once the indicator says `LIVE`, send these commands from another Twitch chat account (or from your broadcaster account):

   - `!clue`
   - `!investigate control`
   - `!investigate archive`
   - `!investigate rooftop`
   - `!vote A`, `!vote B`, or `!vote C`

   The overlay and dashboard should update from the real EventSub messages. When all three clues are found, voting opens. Select **Reveal ending** to close the vote and show the community ending.

This app uses Twitch’s Authorization Code Grant with the Client Secret kept server-side. Node validates the token after exchange and hourly, refreshes it before expiry, subscribes to `channel.chat.message` over EventSub WebSockets, and sends short command replies through Helix. Twitch authorization is not simulated; a real Twitch app and broadcaster authorization are required.

## OBS Browser Source

1. Start the app on the streaming computer and keep it running.
2. In OBS, add a **Browser** source. Use `http://localhost:4173/?overlay=1` as its URL.
3. Set the source canvas to `1920 × 1080`, then place and scale the overlay frame in the lower-left area of the canvas.
4. Leave LiveMystery running and connected to Twitch. The overlay is read-only; it receives clues, votes, and the verdict over the local `/api/events` stream. It needs no Twitch login of its own.

## Game rules

The community investigates three locations. The control room is the first lead; its clue opens two trails. The first follow-up investigation in the signal archive or on the rooftop commits the story to that branch, which changes the final evidence detail. Both trails remain searchable. Each new `!investigate` command in an unlocked room reveals one authored clue. Duplicate investigations register activity but do not add duplicate evidence. `!clue` points chat toward the next unsearched room. Each Twitch username has one active vote and can change it before the streamer reveals the verdict. Ties go to A, then B, then C. The three verdicts identify Mara Voss, Eli Ward, or Rowan Pike as the community’s chosen suspect.

The in-memory state is shared with dashboard and overlay while the local server runs. There is no disk database or cross-process persistence in this MVP; stopping Node starts a fresh investigation. Tokens are not required by the overlay or relay.

## Check the project

```sh
npm run check
npm test
```

The game-rule checks cover discovery, invalid locations, branching, voting, changing a vote, tie resolution, and hiding individual voter names from the public overlay state. Server smoke checks cover the OAuth authorization redirect and state cookie without sending credentials to Twitch. **A live Twitch exchange and chat integration test has not been performed in this environment.** It requires your registered app and broadcaster authorization; only claim a live connection succeeded after the dashboard reaches `LIVE` and an actual chat command appears in the activity feed.

## Repository and public-demo checklist

1. Review the initialized local Git repository with `git status`. Create or connect a public GitHub remote when you are ready, and confirm no app secrets or OAuth tokens are present.
2. Verify the Twitch app redirect URL and required scopes match this README. Do not publish `.env` files, OAuth tokens, or screen recordings that expose them.
3. Run `npm test` and `npm run check`; connect a real Twitch test channel and capture an actual command-to-overlay update.
4. Add the project to the hackathon entry, confirm the event’s current submission requirements and deadline, and include a public code repository link.
5. Make sure the demo channel, OAuth authorization, browser tab, OBS source, and network are ready before recording. A publicly hosted demo is optional; the project runs locally without a hosting bill.

## English project description

**LiveMystery AI turns Twitch chat into the investigation team.** Viewers use real chat commands to search a branching mystery, reveal evidence on a shared live dashboard, and vote on the ending. Streamers get a transparent OBS overlay that mirrors the community’s progress in real time. The free local MVP uses Twitch EventSub and the Twitch API for real chat, requires no paid AI or hosting, and keeps the Confidential Client Secret and OAuth tokens on the local Node server.

## YouTube demo plan (about 2:30)

- **0:00–0:15 — The hook:** Show the mystery title and ask: “What if chat could actually solve the story?”
- **0:15–0:35 — The streamer view:** Show the dashboard and OBS overlay side by side. Point out the live investigation meter and evidence board.
- **0:35–0:55 — Real Twitch connection:** Show the `LIVE` status and a real `!clue` message in chat. Keep OAuth screens and tokens out of the recording.
- **0:55–1:35 — Solve together:** Send the three real `!investigate` commands from Twitch chat. Show each discovered clue appear on the board and overlay.
- **1:35–2:05 — Community choice:** Cast real votes for A, B, and C. Reveal the winning ending and show the updated overlay.
- **2:05–2:25 — How it’s built:** Explain the zero-cost local setup, EventSub, deterministic branching, and in-memory privacy-conscious token handling.
- **2:25–2:30 — Close:** Name the TwitchCon Codex hackathon and share the repository link.

## Architecture notes

```text
dashboard ── OAuth redirect ──> Twitch
    │                             │ code callback
    │                             ▼
    └── SSE ── localhost Node server ── EventSub WebSocket / Helix ── Twitch
                        │
                        ├── game state
                        └── OBS overlay SSE
```

Official references: [Twitch Chat](https://dev.twitch.tv/docs/chat/), [EventSub](https://dev.twitch.tv/docs/eventsub/), [OAuth access tokens](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/), [token validation](https://dev.twitch.tv/docs/authentication/validate-tokens), [app registration](https://dev.twitch.tv/docs/authentication/register-app), [OAuth scopes](https://dev.twitch.tv/docs/authentication/scopes/), and [sending/receiving chat messages](https://dev.twitch.tv/docs/chat/send-receive-messages/).
