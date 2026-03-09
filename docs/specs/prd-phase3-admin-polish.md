# Phase 3: Admin & Polish — API, Lifecycle, Config, Auto-shutdown

This phase adds operational control. The server gains a proper lifecycle: it starts in a "stopped" state where WebSocket connections are rejected, and an admin starts it via HTTP API to begin accepting players. All admin endpoints sit behind Bearer token auth using an API key from a Workers environment variable. The admin can start/stop the server, start/stop rounds, check status, and update config (pacman count, tick rate, power pellet duration) — config changes take effect next round. Auto-shutdown keeps costs down: if no players are connected for 3 hours, the Durable Object uses the Cloudflare Alarm API to stop itself and go idle. This phase wires together the lifecycle states that Phase 1 and 2 built, adding the control plane on top.

## Deliverables

- [ ] Server lifecycle states: **stopped** → **running** (lobby) → **round** → **running** (lobby), with transitions enforced
- [ ] Reject WebSocket connections with `error` message when server is stopped
- [ ] Reject new connections during an active round (joining only allowed in lobby)
- [ ] Admin auth middleware — `Authorization: Bearer <key>` validated against Workers env var; 401 on mismatch
- [ ] `GET /admin/status` — returns server state, player list, round status
- [ ] `POST /admin/server/start` — move server to running, accept connections
- [ ] `POST /admin/server/stop` — disconnect all clients, force-end round if active, move to stopped
- [ ] `POST /admin/round/start` — start round (requires server running + players in lobby)
- [ ] `POST /admin/round/stop` — force-stop round, broadcast results, return to lobby
- [ ] `PUT /admin/config` — update `pacmanCount`, `tickRate`, `powerPelletDuration`; changes apply next round only
- [ ] Config system — defaults from `config.yaml`, runtime overrides stored in DO storage, merged at round start
- [ ] Auto-shutdown — Cloudflare Alarm set for 3 hours when last player disconnects; any new connection resets the timer; alarm fires → server stops itself
- [ ] Worker routing — `/admin/*` routes to admin handler, `GET /ws` routes to WebSocket upgrade

## Acceptance

Start server via admin API, connect players, start a round, force-stop it, see everyone return to lobby. Update config, start another round, verify new settings apply. Stop the server, try to connect a client, get rejected. Verify auto-shutdown alarm is set when last player leaves.
