# Multiplayer Pacman — Server Feature List

> Hackathon game server. Participants build clients in 3 hours. Keep it playable, keep it simple.

---

## 1. Connection & Session

- [ ] WebSocket endpoint for client connections (Durable Object per game room)
- [ ] Single game room — no room creation/listing
- [ ] Client sends `join` with a display name, server assigns a player ID and role
- [ ] Heartbeat/ping-pong to detect disconnected clients
- [ ] No reconnection — if you disconnect, rejoin as a new player
- [ ] Max player cap from config (default: 10)

## 2. Server Lifecycle

- [ ] Server starts in **stopped** state — no client connections accepted
- [ ] Admin starts the server via `POST /admin/server/start` → server moves to **running**, accepts connections
- [ ] Admin stops the server via `POST /admin/server/stop` → all clients disconnected, active round force-ended, server moves to **stopped**
- [ ] Auto-shutdown: if 0 players are connected for 3 hours, server stops itself
  - Use Cloudflare Alarm API to schedule the check
  - Any new connection resets the timer
- [ ] When stopped, the Durable Object can go idle and stop incurring duration charges
- [ ] Client connections while server is stopped receive an `error` message and are closed

## 3. Lobby

- [ ] Players connect and wait in lobby until admin starts a round
- [ ] Broadcast player roster on join/leave so clients can show a waiting screen
- [ ] Joining only allowed in lobby — new connections during a round are rejected

## 4. Role Assignment

- [ ] Configurable number of pacmans (default: 1), rest are ghosts
- [ ] Random assignment at round start
- [ ] If a pacman disconnects mid-round, round continues — ghosts just need to eat remaining pacmans
- [ ] If all pacmans disconnect, round ends (ghosts win)

## 5. Game Loop

- [ ] Server-authoritative: clients send direction input, server computes everything
- [ ] Tick-based loop via `setInterval` inside the Durable Object
- [ ] Fixed tick rate (e.g., ~20 ticks/sec — configurable in YAML)
- [ ] Grid-based movement: players move one cell per tick in their current direction
- [ ] Movement into walls is ignored — player keeps current position
- [ ] Players are stationary until first input received
- [ ] Players have a status: active, vulnerable (ghost during power pellet), dead/respawning
- [ ] Collision detection each tick:
  - Pacman + dot → dot consumed, score incremented
  - Pacman + power pellet → ghosts become vulnerable for N ticks
  - Pacman + ghost (normal) → pacman dies (single life, no respawn)
  - Pacman + ghost (vulnerable) → ghost eaten, respawns at ghost house after N ticks
- [ ] Full game state broadcast every tick (no delta updates)

## 6. Round Flow

- [ ] Admin starts round → server assigns roles, game begins
- [ ] Round ends when:
  - All dots eaten → pacman(s) win
  - All pacmans dead → ghosts win
  - Admin force-stops the round
- [ ] On round end: broadcast results with final scores, return to lobby
- [ ] Scores reset each round — no persistent leaderboard

## 7. Map

- [ ] Single default map shipped in YAML
- [ ] Map defines: walls, dots, power pellet positions, pacman spawn(s), ghost house spawn
- [ ] Map sent to clients at round start (clients render however they want)
- [ ] Map validation at startup: ensure spawn points exist

## 8. Client Protocol (WebSocket, JSON)

**Client → Server:**
| Message | Fields | Notes |
|---------|--------|-------|
| `join` | `name: string` | Join the game |
| `input` | `direction: "up"\|"down"\|"left"\|"right"` | Set movement direction |

**Server → Client:**
| Message | Fields | Notes |
|---------|--------|-------|
| `welcome` | `id, name, players[]` | Connection confirmed |
| `lobby` | `players[]` | Roster update while waiting |
| `round_start` | `map, role, players[], config` | Round begins, includes full map |
| `state` | `players[], dots[], powerPellets[], scores` | Every tick |
| `round_end` | `result: "pacman"\|"ghosts", scores` | Round over |
| `error` | `message: string` | Something went wrong |

Keep the protocol minimal — hackathon participants shouldn't need to handle more than 6 message types.

## 9. Admin API (HTTP + API Key)

- [ ] Auth: `Authorization: Bearer <key>` header, key from env var
- [ ] Endpoints:
  - `GET  /admin/status` — server state, room state, player list, round status
  - `POST /admin/server/start` — start the server (accept connections)
  - `POST /admin/server/stop` — stop the server (disconnect all, end round if active)
  - `POST /admin/round/start` — start round (requires server running + players in lobby)
  - `POST /admin/round/stop` — force-stop round, return to lobby
  - `PUT  /admin/config` — update config (takes effect next round)
    - `pacmanCount`: number of pacmans
    - `tickRate`: ticks per second
    - `powerPelletDuration`: ticks of vulnerability
- [ ] Config changes apply at next round start only

## 10. Configuration

- [ ] Defaults from `config.yaml` in the project:
  ```yaml
  maxPlayers: 10
  pacmanCount: 1
  tickRate: 20
  powerPelletDuration: 100  # ticks (~5 seconds at 20 tps)
  ghostRespawnDelay: 60     # ticks (~3 seconds at 20 tps)
  idleShutdownMinutes: 180  # auto-stop server after 3 hours with 0 players
  ```
- [ ] Runtime overrides via admin API, stored in Durable Object storage
- [ ] Map defined in separate YAML file (or section of the same file)

## 11. Infrastructure

- [ ] Cloudflare Worker — HTTP entrypoint + WebSocket upgrade
- [ ] Single Durable Object — game state, lobby, game loop
- [ ] Routes:
  - `GET /ws` → WebSocket upgrade → game client
  - `/admin/*` → admin HTTP API
- [ ] Wrangler config for deployment
- [ ] Admin API key in Workers environment variable

---

## Out of Scope

- Multiple rooms
- Reconnection / session persistence
- Spectator mode
- Persistent leaderboard
- AI bots
- Chat
- TUI admin client (separate project)
- Game clients (separate projects, built by hackathon participants)