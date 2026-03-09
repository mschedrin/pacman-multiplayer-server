# Phase 3: Admin & Polish — API, Lifecycle, Config, Auto-shutdown

This phase adds operational control. The server gains a proper lifecycle: a new `stopped` state is added on top of the existing `lobby`/`playing` states from Phase 2. The server starts in `stopped`, where WebSocket connections are rejected, and an admin starts it via HTTP API to transition to `lobby` and begin accepting players. All admin endpoints sit behind Bearer token auth using `ADMIN_API_KEY` from a Workers environment variable (added to the `Env` interface in `types.ts`). The admin can start/stop the server, start/stop rounds, check status, and update config (pacman count, tick rate, power pellet duration) — config changes take effect next round. Auto-shutdown keeps costs down: if no players are connected for 3 hours, the Durable Object uses the Cloudflare Alarm API to stop itself and go idle. This phase wires together the lifecycle states that Phase 1 and 2 built, adding the control plane on top.

## Current State (from Phase 1 & 2)

- `RoundState` is `"lobby" | "playing"` — defined in `types.ts`
- Joins during active rounds are already rejected in `game-room.ts`
- `GET /ws` routing already exists in `index.ts`; all other routes return 404
- Config defaults are hardcoded as `DEFAULTS` constant in `types.ts` (`GameConfig`: `tickRate`, `powerPelletDuration`, `ghostRespawnDelay`)
- `pacmanCount` (hardcoded to 1) and `maxPlayers` (hardcoded to 10) live in `game-room.ts`, not in `GameConfig`
- `collision.ts` imports `DEFAULTS` directly — not configurable at runtime
- `Env` interface only has `GAME_ROOM` binding
- No DO storage usage (`this.ctx.storage` never called)
- No alarm logic

## Deliverables

- [ ] Add `stopped` to `RoundState` (`"stopped" | "lobby" | "playing"`); server initializes in `stopped`; enforce transitions: `stopped → lobby → playing → lobby`
- [ ] Reject WebSocket connections with `error` message when server is `stopped`
- [x] ~~Reject new connections during an active round (joining only allowed in lobby)~~ — already implemented in Phase 2
- [ ] Add `ADMIN_API_KEY` to `Env` interface in `types.ts` and to `wrangler.jsonc` as a secret
- [ ] Admin auth middleware — `Authorization: Bearer <key>` validated against `env.ADMIN_API_KEY`; 401 on mismatch
- [ ] `GET /admin/status` — returns server state, player list, round status
- [ ] `POST /admin/server/start` — transition from `stopped` to `lobby`, accept connections
- [ ] `POST /admin/server/stop` — disconnect all clients, force-end round if active, transition to `stopped`
- [ ] `POST /admin/round/start` — start round (requires server in `lobby` + players present)
- [ ] `POST /admin/round/stop` — force-stop round, broadcast results, return to `lobby`
- [ ] `PUT /admin/config` — update `pacmanCount`, `tickRate`, `powerPelletDuration`; changes apply next round only
- [ ] Expand `GameConfig` to include `pacmanCount` and `maxPlayers`; remove hardcoded values from `game-room.ts`
- [ ] Config system — defaults from `DEFAULTS` in `types.ts`, runtime overrides stored in DO storage (`this.ctx.storage`), merged at round start
- [ ] Refactor config flow: thread runtime config through `tick()` and into `collision.ts` functions instead of direct `DEFAULTS` imports
- [ ] Auto-shutdown — Cloudflare Alarm set for 3 hours when last player disconnects; any new connection resets the timer; alarm fires → server stops itself
- [ ] Add `/admin/*` routing in `index.ts` (Worker entrypoint); forward admin requests to DO with auth

## Acceptance

Start server via admin API, connect players, start a round, force-stop it, see everyone return to lobby. Update config, start another round, verify new settings apply. Stop the server, try to connect a client, get rejected. Verify auto-shutdown alarm is set when last player leaves.
