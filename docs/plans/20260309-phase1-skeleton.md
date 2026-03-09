# Phase 1: Skeleton — Connections & Lobby

## Overview

Stand up the Cloudflare Workers + Durable Object infrastructure and prove that clients can connect via WebSocket, identify themselves with a display name, and see each other in a lobby. Disconnections are detected and the roster updates accordingly. No game logic — purely "connect, see who's here, disconnect cleanly."

- PRD: `docs/specs/prd-phase1-skeleton.md`
- Feature spec: `docs/specs/feature-list.md` (sections 1, 3, 8, 11)

## Context

- **Greenfield project** — no code, no package.json, no config files exist yet
- **Stack:** TypeScript, Cloudflare Workers, single Durable Object
- **WebSocket pattern:** Hibernatable WebSockets API — `this.ctx.acceptWebSocket(ws, [tag])`, DO hibernates between events
- **Player tracking:** WebSocket attachments (`ws.serializeAttachment()` / `ws.deserializeAttachment()`) + tags for player ID lookup
- **Ping/pong:** `setWebSocketAutoResponse()` handles keep-alive without waking DO
- **Testing:** Vitest with `@cloudflare/vitest-pool-workers`, test WebSocket flows via `stub.fetch()` with upgrade header
- **Structure:** Flat `src/` — `index.ts` (Worker), `game-room.ts` (DO), `types.ts`

### File structure (end state)

```
├── package.json
├── tsconfig.json
├── wrangler.jsonc
├── vitest.config.ts
├── src/
│   ├── index.ts          # Worker entrypoint
│   ├── game-room.ts      # GameRoom Durable Object
│   └── types.ts          # Shared type definitions
└── test/
    ├── tsconfig.json      # Test-specific TS config
    ├── env.d.ts           # cloudflare:test type declarations
    └── game-room.test.ts  # All Phase 1 tests
```

## Development Approach

- **Testing approach**: Code first, then tests
- Complete each task fully before moving to the next
- Make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
- **CRITICAL: all tests must pass before starting next task**
- **CRITICAL: update this plan file when scope changes during implementation**
- Run tests after each change

## Testing Strategy

- **Framework:** Vitest with `@cloudflare/vitest-pool-workers`
- **WebSocket testing:** Use `stub.fetch("http://fake-host/ws", { headers: { Upgrade: "websocket" } })` to get a client WebSocket from the response, then send/receive JSON messages through it
- **DO internals:** Use `runInDurableObject(stub, callback)` when direct instance access is needed
- **Isolation:** Each test gets isolated storage automatically; DOs from one test don't affect others

## Progress Tracking

- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope

## Implementation Steps

### Task 1: Project scaffolding

**Create:** `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `src/index.ts`, `src/game-room.ts`, `src/types.ts`, `test/tsconfig.json`, `test/env.d.ts`

- [ ] Create `package.json` with project name `pacman-multiplayer-server`, scripts: `dev` (`wrangler dev`), `deploy` (`wrangler deploy`), `test` (`vitest run`), `test:watch` (`vitest`)
- [ ] Install dependencies: `wrangler`, `@cloudflare/workers-types` (dev); `vitest@~3.2.0`, `@cloudflare/vitest-pool-workers` (dev)
- [ ] Create `tsconfig.json` — target `ES2022`, module `ESNext`, moduleResolution `Bundler`, types `["@cloudflare/workers-types"]`, strict mode
- [ ] Create `wrangler.jsonc` — name `pacman-server`, main `src/index.ts`, compatibility date `2024-04-03`, DO binding (`GAME_ROOM` → `GameRoom`), migration tag `v1` with `new_sqlite_classes: ["GameRoom"]`, dev port 8000
- [ ] Create stub `src/index.ts` — Worker `fetch` handler that returns 200 OK with `"Pacman server running"`
- [ ] Create stub `src/game-room.ts` — `GameRoom extends DurableObject<Env>` with constructor calling `super()`
- [ ] Create `src/types.ts` — `Env` interface with `GAME_ROOM: DurableObjectNamespace<GameRoom>`
- [ ] Create `vitest.config.ts` — `defineWorkersConfig` pointing to `wrangler.jsonc`
- [ ] Create `test/tsconfig.json` extending root, adding `@cloudflare/vitest-pool-workers` types
- [ ] Create `test/env.d.ts` declaring `cloudflare:test` `ProvidedEnv extends Env`
- [ ] Verify `npx wrangler dev` starts without errors
- [ ] Write smoke test in `test/game-room.test.ts`: Worker responds 200 to HTTP request via `SELF.fetch()`
- [ ] Run tests — must pass before next task

### Task 2: WebSocket upgrade and DO routing

**Modify:** `src/index.ts`, `src/game-room.ts` | **Modify:** `test/game-room.test.ts`

- [ ] In `src/index.ts`: route `GET /ws` requests to DO via `env.GAME_ROOM.idFromName("default")` → `env.GAME_ROOM.get(id)` → `stub.fetch(request)` (single room, fixed ID)
- [ ] In `src/index.ts`: if `/ws` request lacks `Upgrade: websocket` header, return 426 Upgrade Required
- [ ] In `src/index.ts`: return 404 for any other path (Phase 3 adds `/admin/*`)
- [ ] In `src/game-room.ts`: implement `fetch()` — create `new WebSocketPair()`, call `this.ctx.acceptWebSocket(server)`, return `new Response(null, { status: 101, webSocket: client })`
- [ ] In `src/game-room.ts`: add empty `webSocketMessage(ws, message)` handler
- [ ] In `src/game-room.ts`: add empty `webSocketClose(ws, code, reason, wasClean)` handler
- [ ] Write test: `GET /ws` with upgrade header returns 101 and a WebSocket
- [ ] Write test: `GET /ws` without upgrade header returns 426
- [ ] Write test: `GET /other` returns 404
- [ ] Run tests — must pass before next task

### Task 3: Join flow and player tracking

**Modify:** `src/game-room.ts`, `src/types.ts` | **Modify:** `test/game-room.test.ts`

- [ ] Define types in `src/types.ts`: `Player { id: string, name: string, status: 'lobby' }`, `JoinMessage { type: 'join', name: string }`, `WelcomeMessage { type: 'welcome', id: string, name: string, players: Player[] }`, `ErrorMessage { type: 'error', message: string }`
- [ ] In `webSocketMessage()`: parse JSON, match on `type` field
- [ ] Handle `join`: validate `name` is a non-empty trimmed string; generate player ID with `crypto.randomUUID()`
- [ ] Store player data on WebSocket: `ws.serializeAttachment({ id, name, status: 'lobby' })` and tag the WebSocket with `[playerId]` via `this.ctx.acceptWebSocket(server, [playerId])` at connection time — note: tags must be set at accept time, so instead track join state in attachment and use `getWebSockets()` + `deserializeAttachment()` for roster
- [ ] Send `welcome` message back to joining client: `{ type: 'welcome', id, name, players: [current roster] }`
- [ ] Reject `join` if `name` is missing or empty — send `{ type: 'error', message: 'Name is required' }`
- [ ] Reject duplicate `join` from same WebSocket (already has attachment with id) — send `{ type: 'error', message: 'Already joined' }`
- [ ] Write test: valid join → receives welcome with player ID and roster
- [ ] Write test: join with empty name → receives error
- [ ] Write test: duplicate join from same connection → receives error
- [ ] Run tests — must pass before next task

### Task 4: Lobby broadcast on join/leave

**Modify:** `src/game-room.ts`, `src/types.ts` | **Modify:** `test/game-room.test.ts`

- [ ] Define `LobbyMessage { type: 'lobby', players: Player[] }` in `src/types.ts`
- [ ] After successful join: broadcast `{ type: 'lobby', players }` to ALL connected clients (including the one who just joined)
- [ ] In `webSocketClose()`: retrieve player from `ws.deserializeAttachment()`, if player existed broadcast updated `lobby` to remaining clients
- [ ] Add helper `broadcast(message)` — iterate `this.ctx.getWebSockets()`, send JSON to each
- [ ] Add helper `getPlayerRoster()` — iterate `this.ctx.getWebSockets()`, collect `deserializeAttachment()` results, filter out null (not yet joined)
- [ ] Write test: player A joins, player B joins → both receive lobby with 2 players
- [ ] Write test: player disconnects → remaining players receive updated lobby without disconnected player
- [ ] Run tests — must pass before next task

### Task 5: Max player cap

**Modify:** `src/game-room.ts`, `src/types.ts` | **Modify:** `test/game-room.test.ts`

- [ ] Add `MAX_PLAYERS = 10` constant in `src/game-room.ts` (hardcoded; Phase 3 makes configurable)
- [ ] On `join`: if `getPlayerRoster().length >= MAX_PLAYERS`, send `{ type: 'error', message: 'Server is full' }` and call `ws.close(1008, 'Server is full')`
- [ ] Write test: 10 players join successfully, 11th receives error and connection is closed
- [ ] Write test: player leaves, new player can join (count drops below cap)
- [ ] Run tests — must pass before next task

### Task 6: Heartbeat ping/pong

**Modify:** `src/game-room.ts` | **Modify:** `test/game-room.test.ts`

- [ ] In `GameRoom` constructor: call `this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))` — handles keep-alive without waking DO from hibernation
- [ ] Ensure `webSocketClose(ws, code, reason, wasClean)` cleans up the player and broadcasts updated lobby (already done in Task 4, verify it handles all close codes)
- [ ] Add `webSocketError(ws, error)` handler — close the WebSocket and clean up player same as `webSocketClose`
- [ ] Write test: verify auto-response is configured (send "ping", expect "pong" back without triggering `webSocketMessage`)
- [ ] Write test: connection error triggers player cleanup and lobby broadcast
- [ ] Run tests — must pass before next task

### Task 7: Error handling for malformed messages

**Modify:** `src/game-room.ts` | **Modify:** `test/game-room.test.ts`

- [ ] In `webSocketMessage()`: wrap JSON.parse in try/catch — if message is not valid JSON, send `{ type: 'error', message: 'Invalid JSON' }`
- [ ] If parsed message has unknown `type` field, send `{ type: 'error', message: 'Unknown message type' }`
- [ ] If client sends any message other than `join` before joining (no attachment set), send `{ type: 'error', message: 'Must join first' }` — except ignore `join` validation here (Task 3 handles it)
- [ ] Write test: non-JSON message → error response
- [ ] Write test: unknown message type → error response
- [ ] Write test: message before join (e.g., `{ type: 'input', direction: 'up' }`) → error response
- [ ] Run tests — must pass before next task

### Task 8: Verify acceptance criteria

- [ ] Verify: multiple clients can connect and join with different names
- [ ] Verify: all clients receive lobby roster updates on join/leave
- [ ] Verify: 11th player gets rejected when cap is 10
- [ ] Verify: disconnected client is removed from roster and remaining clients are notified
- [ ] Verify: malformed messages return appropriate errors
- [ ] Verify: ping/pong auto-response works without waking DO
- [ ] Run full test suite: `npm test`
- [ ] Run linter if configured — all issues must be fixed

### Task 9: [Final] Update documentation

- [ ] Update `CLAUDE.md` with actual build/test commands and project file structure
- [ ] Move this plan to `docs/plans/completed/`

## Technical Details

### Message flow

```
Client  →  HTTP GET /ws (Upgrade: websocket)  →  Worker  →  DO.fetch()  →  WebSocketPair
Client  →  { type: "join", name: "Alice" }     →  DO.webSocketMessage()
Client  ←  { type: "welcome", id: "abc", name: "Alice", players: [...] }
All     ←  { type: "lobby", players: [...] }    (broadcast)
Client  ←  { type: "error", message: "..." }    (on invalid input)
```

### Hibernation behavior (Phase 1)

- No timers running (game loop is Phase 2) — DO can fully hibernate between events
- `setWebSocketAutoResponse("ping", "pong")` handles keep-alive without waking DO
- DO wakes only on: `webSocketMessage`, `webSocketClose`, `webSocketError`, or new `fetch`
- On wake from hibernation, constructor re-runs; in-memory state lost but WebSocket attachments survive

### Player tracking via WebSocket attachments

```typescript
// On join — store player data on the WebSocket itself
ws.serializeAttachment({ id: crypto.randomUUID(), name, status: 'lobby' });

// Build roster — iterate all connected WebSockets
getPlayerRoster(): Player[] {
  return this.ctx.getWebSockets()
    .map(ws => ws.deserializeAttachment() as Player | null)
    .filter((p): p is Player => p !== null);
}

// On disconnect — attachment is accessible in webSocketClose handler
webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
  const player = ws.deserializeAttachment() as Player | null;
  // player data available for logging/broadcasting even as connection closes
  ws.close(code, reason);
  this.broadcast({ type: 'lobby', players: this.getPlayerRoster() });
}
```

### Key API signatures used

| API | Signature | Purpose |
|-----|-----------|---------|
| `acceptWebSocket` | `this.ctx.acceptWebSocket(ws: WebSocket): void` | Register WebSocket with Hibernatable API |
| `getWebSockets` | `this.ctx.getWebSockets(): WebSocket[]` | Get all connected WebSockets |
| `setWebSocketAutoResponse` | `this.ctx.setWebSocketAutoResponse(pair: WebSocketRequestResponsePair)` | Ping/pong without waking DO |
| `serializeAttachment` | `ws.serializeAttachment(value: any): void` | Store player data on WebSocket (survives hibernation) |
| `deserializeAttachment` | `ws.deserializeAttachment(): any` | Retrieve player data from WebSocket |

## Post-Completion

**Manual verification:**
- Open 3+ browser tabs to `ws://localhost:8000/ws`, send join messages, verify real-time roster updates
- Kill a tab, verify remaining clients see the player removed within seconds
- Test with `wscat` or similar CLI tool: `wscat -c ws://localhost:8000/ws`
- Try joining with 11+ clients, verify 11th is rejected

**Next phase:**
- Phase 2 adds: map loading, role assignment, game loop, movement, collisions, rounds
- Phase 2 will introduce `setInterval` for tick loop — DO stops hibernating during active rounds
