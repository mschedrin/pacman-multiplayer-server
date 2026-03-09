# Pacman Multiplayer Server

Server-authoritative multiplayer Pacman game server built on Cloudflare Workers and Durable Objects. Designed for hackathons — participants build their own clients in 3 hours.

## How It Works

- One player is Pacman, the rest are ghosts (configurable)
- Clients connect via WebSocket and send direction inputs
- The server runs a tick-based game loop, computes all movement and collisions, and broadcasts full game state every tick
- An admin HTTP API controls the server lifecycle and round flow

## Architecture

- **Cloudflare Worker** — HTTP entrypoint, WebSocket upgrade, admin API routing
- **Durable Object** — single game room holding all state: lobby, game loop, player connections
- **Server-authoritative** — clients only send `join` and `input` messages; the server handles everything else

## Routes

| Route | Purpose |
|-------|---------|
| `GET /ws` | WebSocket upgrade for game clients |
| `/admin/*` | Admin HTTP API (API key auth) |

## Admin API (Phase 3 — not yet implemented)

All endpoints require `Authorization: Bearer <key>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/status` | Server state, players, round status |
| `POST` | `/admin/server/start` | Start server (accept connections) |
| `POST` | `/admin/server/stop` | Stop server (disconnect all) |
| `POST` | `/admin/round/start` | Start a round |
| `POST` | `/admin/round/stop` | Force-stop round |
| `PUT` | `/admin/config` | Update config (applies next round) |

## Client Protocol (WebSocket, JSON)

Clients handle 6 message types total.

**Client sends:**
- `join` — `{ type: "join", name: "PlayerName" }`
- `input` — `{ type: "input", direction: "up"|"down"|"left"|"right" }`

**Server sends:**
- `welcome` — connection confirmed with player ID and roster
- `lobby` — roster updates while waiting
- `round_start` — round begins with map, role assignment, and config
- `state` — full game state every tick (players, dots, power pellets, scores)
- `round_end` — result and final scores
- `error` — error message

## Configuration (Phase 3 — not yet implemented)

Planned defaults (currently `maxPlayers` is hardcoded to 10 in `src/game-room.ts`):

```yaml
maxPlayers: 10
pacmanCount: 1
tickRate: 20
powerPelletDuration: 100  # ticks (~5 sec at 20 tps)
ghostRespawnDelay: 60     # ticks (~3 sec at 20 tps)
idleShutdownMinutes: 180  # auto-stop after 3h with 0 players
```

Runtime overrides available via the admin API.

## Game Rules

- Grid-based movement, one cell per tick
- Pacman eats dots and power pellets for points
- Power pellets make ghosts vulnerable for N ticks
- Ghost touches Pacman → Pacman dies (single life, no respawn)
- Pacman touches vulnerable ghost → ghost eaten, respawns after delay
- Round ends when all dots are eaten (Pacman wins) or all Pacmans are dead (ghosts win)
- Scores reset each round

## Development

Runs in a devcontainer. Port `8000` is forwarded for local development.

```bash
npm run dev        # Start local dev server (wrangler, port 8000)
npm test           # Run all tests
npm run test:watch # Run tests in watch mode
npm run deploy     # Deploy to Cloudflare
```

## Docs

- [Feature List](docs/specs/feature-list.md) — full server specification
