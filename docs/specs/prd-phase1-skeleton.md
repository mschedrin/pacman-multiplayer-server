# Phase 1: Skeleton — Connections & Lobby

This phase stands up the Cloudflare infrastructure and proves that clients can connect, identify themselves, and see each other. A Worker handles HTTP requests and upgrades `/ws` connections to WebSockets, forwarding them to a single Durable Object. The DO manages a player list — when a client sends `join` with a display name, the server assigns an ID, adds them to the roster, and broadcasts the updated player list to everyone. Disconnections are detected via WebSocket close events and a heartbeat ping/pong, and the roster updates accordingly. No game logic exists yet — this is purely "connect, see who's here, disconnect cleanly." At the end of this phase, you can open multiple browser tabs, join with different names, and watch the player list update in real time.

## Deliverables

- [ ] Cloudflare Worker entrypoint with route `GET /ws` that upgrades to WebSocket and forwards to the Durable Object
- [ ] Durable Object class that accepts WebSocket connections and tracks connected players (id, name, status)
- [ ] `join` message handling — validate name, assign unique player ID, send `welcome` response with player's ID and current roster
- [ ] `lobby` broadcast — send updated `players[]` to all clients on every join/leave
- [ ] Heartbeat ping/pong to detect stale connections; clean up player on timeout
- [ ] Max player cap (default 10) — reject connections beyond the limit with an `error` message
- [ ] `error` message for invalid/malformed client messages
- [ ] Wrangler config (`wrangler.toml` or `wrangler.jsonc`) with DO binding and dev settings

## Acceptance

Open 3+ WebSocket clients, join with different names, see roster updates on each join/leave, exceed the player cap and get rejected, kill a client and see it removed from the roster within a few seconds.
