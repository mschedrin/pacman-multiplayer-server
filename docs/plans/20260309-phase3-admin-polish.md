# Phase 3: Admin & Polish — API, Lifecycle, Config, Auto-shutdown

## Overview
- Add operational control to the game server: lifecycle states, admin HTTP API, runtime config, and auto-shutdown
- Server gains a `stopped` state (added to existing `lobby`/`playing` `RoundState`) controlled via admin API with Bearer token auth
- Config system extends existing `DEFAULTS` in `types.ts` with runtime overrides via DO storage; auto-shutdown via Cloudflare Alarm API keeps costs down
- Builds on Phase 1 (WebSocket/lobby) and Phase 2 (game loop/rounds) — assumes both are fully implemented

## Context (from discovery)
- **Existing infrastructure (Phase 1 & 2):**
  - `RoundState` is `"lobby" | "playing"` in `src/types.ts`
  - `GameConfig` type and `DEFAULTS` constant already exist in `src/types.ts` (`tickRate`, `powerPelletDuration`, `ghostRespawnDelay`)
  - `pacmanCount` (1) and `maxPlayers` (10) are hardcoded in `src/game-room.ts`, not in `GameConfig`
  - `collision.ts` imports `DEFAULTS` directly — not configurable at runtime
  - `Env` interface only has `GAME_ROOM` binding
  - `GET /ws` routing exists in `src/index.ts`; all other routes return 404
  - Joins during active rounds already rejected in `game-room.ts`
  - No DO storage usage, no alarm logic
- **Files to modify:**
  - `src/index.ts` — Worker entrypoint, add admin route handling and auth
  - `src/game-room.ts` — Durable Object, add lifecycle states, admin RPC methods, config, alarm
  - `src/types.ts` — Expand `GameConfig` (add `pacmanCount`, `maxPlayers`, `idleShutdownMinutes`), add `ADMIN_API_KEY` to `Env`, add `stopped` to `RoundState`
  - `src/collision.ts` — Refactor to accept config parameter instead of importing `DEFAULTS` directly
  - `src/game-loop.ts` — Thread config through `tick()` pipeline
  - `wrangler.jsonc` — Document `ADMIN_API_KEY` as a secret
- **Files to create:**
  - `src/config.ts` — Config merging/validation logic
  - `test/admin.test.ts` — Admin API tests
  - `test/config.test.ts` — Config system tests
  - `test/lifecycle.test.ts` — Server lifecycle tests
- **Dependencies:** No new npm packages — direct fetch routing, no framework
- **Existing patterns:** WebSocket handling via hibernatable API, game state in DO memory, Vitest + `@cloudflare/vitest-pool-workers`

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
  - tests are not optional — they are a required part of the checklist
  - write unit tests for new functions/methods
  - update existing test cases if behavior changes
  - tests cover both success and error scenarios
- **CRITICAL: all tests must pass before starting next task** — no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- Run tests after each change
- Maintain backward compatibility with Phase 1 & 2 code

## Testing Strategy
- **Unit tests**: required for every task (see Development Approach above)
- Test admin endpoints by calling Worker fetch directly (no HTTP client needed)
- Test config merging as pure functions
- Test lifecycle state transitions on the DO
- Test alarm scheduling via Cloudflare test helpers

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## Implementation Steps

### Task 1: Config system — expand defaults and add merging
- [ ] Expand existing `GameConfig` in `src/types.ts` to include `pacmanCount`, `maxPlayers`, and `idleShutdownMinutes`; update `DEFAULTS` constant accordingly
- [ ] Remove hardcoded `MAX_PLAYERS` (10) and `pacmanCount` (1) from `src/game-room.ts` — use `DEFAULTS` instead
- [ ] Create `src/config.ts` with `mergeConfig(defaults: GameConfig, overrides: Partial<GameConfig>): GameConfig` — merges runtime overrides onto defaults, validates values (positive numbers, sane ranges)
- [ ] Write tests for `mergeConfig` — valid overrides, partial overrides, invalid values rejected
- [ ] Write tests for expanded `DEFAULTS` — all expected keys present with correct defaults
- [ ] Run tests — must pass before next task

### Task 2: Server lifecycle states
- [ ] Add `stopped` to `RoundState` in `src/types.ts` (`"stopped" | "lobby" | "playing"`); initialize `roundState` to `'stopped'` in `GameRoom`
- [ ] Add `startServer()` method — transitions from `stopped` to `lobby`, no-op if already in `lobby` or `playing`
- [ ] Add `stopServer()` method — disconnects all WebSocket clients with error message, force-ends round if active (calls existing round-end logic), transitions to `stopped`
- [ ] Modify WebSocket upgrade handler in DO — reject with `error` message and close when `roundState === 'stopped'`
- [x] ~~Reject new connections during active round (lobby only)~~ — already implemented in Phase 2
- [ ] Write tests for `startServer` / `stopServer` state transitions
- [ ] Write tests for connection rejection when stopped
- [ ] Run tests — must pass before next task

### Task 3: Admin auth middleware
- [ ] Add `ADMIN_API_KEY` to Worker env type in `src/types.ts`
- [ ] Add `wrangler.jsonc` env var placeholder for `ADMIN_API_KEY` (secret, not committed)
- [ ] Create auth check function in `src/index.ts`: extract `Authorization: Bearer <token>` header, compare against `env.ADMIN_API_KEY`, return 401 JSON response on mismatch/missing
- [ ] Write tests for auth — valid token passes, missing header returns 401, wrong token returns 401
- [ ] Run tests — must pass before next task

### Task 4: Worker routing for admin endpoints
- [ ] Modify `src/index.ts` fetch handler to route `/admin/*` requests through auth check, then forward to DO
- [ ] Add RPC method stubs on DO for admin operations (will be implemented in subsequent tasks)
- [ ] Route `GET /admin/status` → DO `getStatus()` RPC
- [ ] Route `POST /admin/server/start` → DO `startServer()` RPC
- [ ] Route `POST /admin/server/stop` → DO `stopServer()` RPC
- [ ] Route `POST /admin/round/start` → DO `startRound()` RPC (existing from Phase 2, expose via HTTP)
- [ ] Route `POST /admin/round/stop` → DO `stopRound()` RPC (existing from Phase 2, expose via HTTP)
- [ ] Route `PUT /admin/config` → DO `updateConfig()` RPC
- [ ] Return 404 JSON for unknown `/admin/*` routes
- [ ] Write tests for routing — correct method+path dispatches to correct handler, wrong method returns 405, unknown path returns 404
- [ ] Write tests for auth integration — all admin routes require valid Bearer token
- [ ] Run tests — must pass before next task

### Task 5: Admin status endpoint
- [ ] Implement `getStatus()` RPC on DO — returns `{ roundState, players: [{id, name, role, status}], config: GameConfig }`
- [ ] `roundState` is the current `RoundState` value (`'stopped' | 'lobby' | 'playing'`)
- [ ] Wire `GET /admin/status` to return JSON response from `getStatus()`
- [ ] Write tests for status response in each server state (stopped, running/lobby, running/playing)
- [ ] Run tests — must pass before next task

### Task 6: Server lifecycle endpoints
- [ ] Wire `POST /admin/server/start` — call `startServer()`, return `{ ok: true, roundState: 'lobby' }`
- [ ] Wire `POST /admin/server/stop` — call `stopServer()`, return `{ ok: true, roundState: 'stopped' }`
- [ ] Return appropriate error if transition is invalid (e.g., starting an already-running server returns `{ ok: true }` as no-op, not an error)
- [ ] Write tests for start/stop via HTTP — state transitions, response format, idempotent behavior
- [ ] Run tests — must pass before next task

### Task 7: Round control endpoints
- [ ] Wire `POST /admin/round/start` — validate server is running and players are in lobby, call existing `startRound()`, return `{ ok: true, roundState: 'playing' }`
- [ ] Return 409 error if server not running, no players connected, or round already active
- [ ] Wire `POST /admin/round/stop` — call existing `stopRound()` (force-end), return `{ ok: true, roundState: 'lobby' }`
- [ ] Return 409 error if no round is active
- [ ] Write tests for round start — success, failure cases (server stopped, no players, round already active)
- [ ] Write tests for round stop — success, failure case (no active round)
- [ ] Run tests — must pass before next task

### Task 8: Config update endpoint
- [ ] Implement `updateConfig(overrides: Partial<GameConfig>)` RPC on DO — validate input, store overrides in DO storage (`this.ctx.storage.put('configOverrides', overrides)`)
- [ ] Config changes stored but NOT applied to current round — merged at next `startRound()`
- [ ] Wire `PUT /admin/config` — parse JSON body, call `updateConfig()`, return `{ ok: true, config: mergedConfig }`
- [ ] Return 400 for invalid config values (non-positive numbers, unknown keys)
- [ ] Modify `startRound()` to load overrides from storage and merge with defaults before round begins
- [ ] Write tests for config update — valid partial update, invalid values rejected, stored in DO storage
- [ ] Write tests for config merge at round start — overrides applied, defaults used for non-overridden values
- [ ] Run tests — must pass before next task

### Task 9: Auto-shutdown via Cloudflare Alarm API
- [ ] On last player disconnect (player count drops to 0 while server is running): set alarm via `this.ctx.storage.setAlarm(Date.now() + idleShutdownMinutes * 60 * 1000)`
- [ ] On new player connect (while alarm is pending): cancel alarm via `this.ctx.storage.deleteAlarm()`
- [ ] Implement `alarm()` handler on DO — if still 0 players, call `stopServer()`; if players connected, no-op (race condition guard)
- [ ] Use `idleShutdownMinutes` from merged config (default 180 = 3 hours)
- [ ] Write tests for alarm set on last player disconnect
- [ ] Write tests for alarm cancel on new player connect
- [ ] Write tests for alarm handler — stops server when 0 players, no-op when players connected
- [ ] Run tests — must pass before next task

### Task 10: Config integration — wire config through tick pipeline
- [ ] Refactor `tick()` in `src/game-loop.ts` to accept `GameConfig` parameter and pass it to collision functions
- [ ] Refactor `collision.ts` functions (`checkPelletCollisions`, `checkPlayerCollisions`, `updateTimers`) to accept config instead of importing `DEFAULTS` directly
- [ ] Update `startGameLoop()` in `game-room.ts` to use merged config `tickRate` for `setInterval`
- [ ] Update `startRound()` in `game-room.ts` to use merged config `pacmanCount` for `assignRoles()` and `maxPlayers` for player cap
- [ ] Update existing Phase 2 tests that call `tick()` or collision functions to pass config
- [ ] Write tests verifying config values are respected — e.g., different tick rate, different pacman count, different power pellet duration
- [ ] Run tests — must pass before next task

### Task 11: Verify acceptance criteria
- [ ] Verify full lifecycle: start server → connect players → start round → force-stop round → players return to lobby
- [ ] Verify config flow: update config → start round → new settings apply
- [ ] Verify auth: all admin endpoints reject without valid Bearer token
- [ ] Verify connection rejection: stop server → try to connect → get error message
- [ ] Verify auto-shutdown: last player leaves → alarm set; new player joins → alarm cancelled
- [ ] Run full test suite (unit tests)
- [ ] Run linter — all issues must be fixed

### Task 12: [Final] Update documentation
- [ ] Update `README.md` with admin API usage (endpoints, auth setup)
- [ ] Update `CLAUDE.md` build commands if any changed
- [ ] Document `ADMIN_API_KEY` env var setup in README

## Technical Details

### Server State Machine (`RoundState`)
```
stopped ──[POST /admin/server/start]──► lobby
                                          │
                            [POST /admin/round/start]
                                          │
                                          ▼
                                       playing
                                          │
                            [round ends / POST /admin/round/stop]
                                          │
                                          ▼
                                        lobby

lobby|playing ──[POST /admin/server/stop]──► stopped
lobby|playing ──[alarm fires, 0 players]──► stopped
```

### Admin API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/status` | Bearer | Server state, players, config |
| POST | `/admin/server/start` | Bearer | Start server, accept connections |
| POST | `/admin/server/stop` | Bearer | Stop server, disconnect all |
| POST | `/admin/round/start` | Bearer | Start round (requires running + players) |
| POST | `/admin/round/stop` | Bearer | Force-stop round |
| PUT | `/admin/config` | Bearer | Update runtime config |

### Config Merge Order
1. `DEFAULTS` constant in `src/types.ts` (expanded with `pacmanCount`, `maxPlayers`, `idleShutdownMinutes`)
2. Runtime overrides from DO storage (`configOverrides`)
3. Merged result used at next round start and passed through tick pipeline

### Files Modified/Created
| File | Action | Purpose |
|------|--------|---------|
| `src/types.ts` | Modify | Expand `GameConfig` + `DEFAULTS`, add `stopped` to `RoundState`, add `ADMIN_API_KEY` to `Env` |
| `src/config.ts` | Create | Config merge/validation logic |
| `src/index.ts` | Modify | Admin routing, auth middleware |
| `src/game-room.ts` | Modify | Lifecycle states, admin RPCs, alarm, config storage |
| `src/game-loop.ts` | Modify | Accept `GameConfig` param in `tick()`, pass to collision functions |
| `src/collision.ts` | Modify | Accept config param instead of importing `DEFAULTS` directly |
| `wrangler.jsonc` | Modify | Document `ADMIN_API_KEY` secret |
| `test/config.test.ts` | Create | Config merge tests |
| `test/admin.test.ts` | Create | Admin endpoint tests |
| `test/lifecycle.test.ts` | Create | Lifecycle + alarm tests |

## Post-Completion
*Items requiring manual intervention or external systems — no checkboxes, informational only*

**Manual verification:**
- Deploy to Cloudflare and test admin API with curl
- Verify auto-shutdown works with real Alarm API timing
- Load test with multiple concurrent WebSocket connections

**External system updates:**
- Set `ADMIN_API_KEY` secret via `npx wrangler secret put ADMIN_API_KEY`
- Update any client documentation with connection rejection behavior during stopped/round states
