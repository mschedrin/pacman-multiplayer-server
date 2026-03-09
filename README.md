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

## Admin API

All endpoints require `Authorization: Bearer <key>` header. Set the API key as a Cloudflare secret:

```bash
npx wrangler secret put ADMIN_API_KEY
```

For local development, add `ADMIN_API_KEY` to a `.dev.vars` file (not committed):

```
ADMIN_API_KEY=your-dev-key-here
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/status` | Server state, players, config |
| `POST` | `/admin/server/start` | Start server (accept connections) |
| `POST` | `/admin/server/stop` | Stop server (disconnect all) |
| `POST` | `/admin/round/start` | Start a round (requires lobby + players) |
| `POST` | `/admin/round/stop` | Force-stop active round |
| `PUT` | `/admin/config` | Update config (applies next round) |

Server starts in `stopped` state. Typical flow:

```bash
# Start the server
curl -X POST http://localhost:8000/admin/server/start \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Players connect via WebSocket...

# Start a round
curl -X POST http://localhost:8000/admin/round/start \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Check status
curl http://localhost:8000/admin/status \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Update config for next round
curl -X PUT http://localhost:8000/admin/config \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pacmanCount": 2, "tickRate": 15}'
```

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

## Configuration

Default config values (defined in `src/types.ts`):

```yaml
maxPlayers: 10
pacmanCount: 1
tickRate: 20               # ticks per second
powerPelletDuration: 100   # ticks (~5 sec at 20 tps)
ghostRespawnDelay: 60      # ticks (~3 sec at 20 tps)
idleShutdownMinutes: 180   # auto-stop after 3h with 0 players
```

Config can be updated at runtime via `PUT /admin/config` with a partial JSON object. Changes are stored in Durable Object storage and applied at the next round start.

Auto-shutdown: when all players disconnect, an alarm is set for `idleShutdownMinutes`. If no one reconnects before it fires, the server stops automatically.

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
