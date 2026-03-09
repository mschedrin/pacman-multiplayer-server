# Phase 3: Admin & Polish — API, Lifecycle, Config, Auto-shutdown

## Overview
- Add operational control to the game server: lifecycle states, admin HTTP API, runtime config, and auto-shutdown
- Server gains stopped/running states controlled via admin API with Bearer token auth
- Config system provides YAML defaults with runtime overrides; auto-shutdown via Cloudflare Alarm API keeps costs down
- Builds on Phase 1 (WebSocket/lobby) and Phase 2 (game loop/rounds) — assumes both are fully implemented

## Context (from discovery)
- **Files to modify:**
  - `src/index.ts` — Worker entrypoint, add admin route handling and auth
  - `src/game-room.ts` — Durable Object, add lifecycle states, admin RPC methods, config, alarm
  - `src/types.ts` — Add admin/config type definitions
- **Files to create:**
  - `src/config.ts` — Config loading, defaults, merging logic
  - `config.yaml` — Default config values
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

### Task 1: Config system — defaults and merging
- [ ] Create `config.yaml` with defaults: `maxPlayers: 10`, `pacmanCount: 1`, `tickRate: 20`, `powerPelletDuration: 100`, `ghostRespawnDelay: 60`, `idleShutdownMinutes: 180`
- [ ] Create `src/config.ts` with `GameConfig` type and `DEFAULT_CONFIG` constant (hardcoded defaults matching YAML)
- [ ] Add `mergeConfig(defaults: GameConfig, overrides: Partial<GameConfig>): GameConfig` — merges runtime overrides onto defaults, validates values (positive numbers, sane ranges)
- [ ] Add config types to `src/types.ts`
- [ ] Write tests for `mergeConfig` — valid overrides, partial overrides, invalid values rejected
- [ ] Write tests for `DEFAULT_CONFIG` — all expected keys present with correct defaults
- [ ] Run tests — must pass before next task

### Task 2: Server lifecycle states
- [ ] Add `serverState: 'stopped' | 'running'` field to `GameRoom` DO (default: `'stopped'`)
- [ ] Add `startServer()` method — sets state to `'running'`, no-op if already running
- [ ] Add `stopServer()` method — disconnects all WebSocket clients with error message, force-ends round if active (calls existing round-end logic), sets state to `'stopped'`
- [ ] Modify WebSocket upgrade handler in DO — reject with `error` message and close when `serverState === 'stopped'`
- [ ] Modify WebSocket upgrade handler — reject new connections during active round (lobby only)
- [ ] Write tests for `startServer` / `stopServer` state transitions
- [ ] Write tests for connection rejection when stopped
- [ ] Write tests for connection rejection during active round
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
- [ ] Implement `getStatus()` RPC on DO — returns `{ serverState, roundState, players: [{id, name, role, status}], config: GameConfig }`
- [ ] `roundState` is `'lobby' | 'playing' | null` (null when server is stopped)
- [ ] Wire `GET /admin/status` to return JSON response from `getStatus()`
- [ ] Write tests for status response in each server state (stopped, running/lobby, running/playing)
- [ ] Run tests — must pass before next task

### Task 6: Server lifecycle endpoints
- [ ] Wire `POST /admin/server/start` — call `startServer()`, return `{ ok: true, serverState: 'running' }`
- [ ] Wire `POST /admin/server/stop` — call `stopServer()`, return `{ ok: true, serverState: 'stopped' }`
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

### Task 10: Config integration — wire config into game systems
- [ ] Replace any hardcoded `maxPlayers` in Phase 1 code with config value
- [ ] Replace any hardcoded tick rate in `setInterval` with `config.tickRate`
- [ ] Replace any hardcoded `pacmanCount` in role assignment with config value
- [ ] Replace any hardcoded `powerPelletDuration` and `ghostRespawnDelay` in collision/game-loop code with config values
- [ ] Write tests verifying config values are respected — e.g., different tick rate, different pacman count
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

### Server State Machine
```
stopped ──[POST /admin/server/start]──► running (lobby)
                                            │
                              [POST /admin/round/start]
                                            │
                                            ▼
                                      running (round)
                                            │
                              [round ends / POST /admin/round/stop]
                                            │
                                            ▼
                                      running (lobby)

running (*) ──[POST /admin/server/stop]──► stopped
running (*) ──[alarm fires, 0 players]──► stopped
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
1. `DEFAULT_CONFIG` (hardcoded, matches `config.yaml`)
2. Runtime overrides from DO storage (`configOverrides`)
3. Result used for next round start

### Files Modified/Created
| File | Action | Purpose |
|------|--------|---------|
| `config.yaml` | Create | Default config values (reference) |
| `src/config.ts` | Create | Config types, defaults, merge logic |
| `src/types.ts` | Modify | Add `GameConfig`, admin types, env types |
| `src/index.ts` | Modify | Admin routing, auth middleware |
| `src/game-room.ts` | Modify | Lifecycle states, admin RPCs, alarm, config storage |
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
