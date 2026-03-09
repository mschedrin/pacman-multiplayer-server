# Admin API Reference

Base URL: `https://<server-host>/admin`

## Authentication

All `/admin/*` endpoints require a Bearer token in the `Authorization` header.

```
Authorization: Bearer <ADMIN_API_KEY>
```

The API key is configured as a server-side environment variable (`ADMIN_API_KEY`).

### Auth Errors

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{ "error": "Missing Authorization header" }` | No `Authorization` header |
| 401 | `{ "error": "Invalid Authorization format" }` | Header doesn't match `Bearer <token>` |
| 401 | `{ "error": "Invalid API key" }` | Token doesn't match server's key |

---

## Endpoints

### GET /admin/status

Returns the current server state, connected players, and active configuration.

**Request:** No body.

**Response (200):**

```json
{
  "roundState": "lobby",
  "players": [
    { "id": "550e8400-...", "name": "TeamA", "role": null, "status": "lobby" },
    { "id": "7c9e6679-...", "name": "TeamB", "role": null, "status": "lobby" }
  ],
  "config": {
    "tickRate": 20,
    "powerPelletDuration": 100,
    "ghostRespawnDelay": 60,
    "pacmanCount": 1,
    "maxPlayers": 10,
    "idleShutdownMinutes": 180
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `roundState` | `"stopped" \| "lobby" \| "playing"` | Current server state |
| `players` | `StatusPlayer[]` | Connected players |
| `config` | `GameConfig` | Active configuration (defaults + overrides) |

**StatusPlayer:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Player UUID |
| `name` | `string` | Display name |
| `role` | `"pacman" \| "ghost" \| null` | Role (null when in lobby) |
| `status` | `string` | Player status: `"lobby"`, `"active"`, `"vulnerable"`, `"dead"`, `"respawning"` |

---

### POST /admin/server/start

Starts the server. Transitions from `stopped` to `lobby` state. Players can now connect via WebSocket.

If the server is already running (in `lobby` or `playing`), this is a no-op and returns the current state.

**Request:** No body.

**Response (200):**

```json
{
  "ok": true,
  "roundState": "lobby"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | Always `true` |
| `roundState` | `string` | State after the operation |

**Side effects:**
- Cancels any pending auto-shutdown alarm
- WebSocket connections to `/ws` are now accepted

---

### POST /admin/server/stop

Stops the server. Disconnects all players and force-ends any active round.

**Request:** No body.

**Response (200):**

```json
{
  "ok": true,
  "roundState": "stopped"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | Always `true` |
| `roundState` | `"stopped"` | Always `"stopped"` |

**Side effects:**
- If a round is active: broadcasts `round_end` (result: `"ghosts"`) to all players
- All connected players receive an `error` message (`"Server stopped"`) and are disconnected (close code 1001)
- New WebSocket connections are rejected until the server is started again

---

### POST /admin/round/start

Starts a game round. Requires the server to be in `lobby` state with at least 2 connected players.

**Request:** No body.

**Response (200) — success:**

```json
{
  "ok": true,
  "roundState": "playing"
}
```

**Response (409) — conflict:**

```json
{
  "ok": false,
  "error": "Need at least 2 players to start"
}
```

| Error message | Cause |
|---------------|-------|
| `"Server is stopped"` | Server hasn't been started |
| `"Round already in progress"` | A round is already active |
| `"Need at least 2 players to start"` | Fewer than 2 players in lobby |

**Side effects:**
- Roles are randomly assigned (configurable `pacmanCount` pacmans, rest are ghosts)
- Players are placed at spawn positions on the map
- Each player receives a `round_start` message with the map, their role, all player positions, and config
- The tick-based game loop starts at the configured `tickRate`
- New WebSocket connections are rejected until the round ends

---

### POST /admin/round/stop

Force-stops an active round and returns to lobby.

**Request:** No body.

**Response (200) — success:**

```json
{
  "ok": true,
  "roundState": "lobby"
}
```

**Response (409) — conflict:**

```json
{
  "ok": false,
  "roundState": "lobby",
  "error": "No active round"
}
```

**Side effects:**
- Broadcasts `round_end` (result: `"ghosts"`) with final scores
- All players return to lobby status
- Broadcasts `lobby` with updated roster
- New WebSocket connections are accepted again

---

### PUT /admin/config

Updates game configuration. Accepts a partial config — only include the fields you want to change.

**Request:**

```json
{
  "tickRate": 30,
  "pacmanCount": 2
}
```

**Response (200) — success:**

```json
{
  "ok": true,
  "config": {
    "tickRate": 30,
    "powerPelletDuration": 100,
    "ghostRespawnDelay": 60,
    "pacmanCount": 2,
    "maxPlayers": 10,
    "idleShutdownMinutes": 180
  }
}
```

**Response (400) — validation error:**

```json
{
  "ok": false,
  "error": "Invalid value for tickRate: must be a positive number",
  "config": {
    "tickRate": 20,
    "powerPelletDuration": 100,
    "ghostRespawnDelay": 60,
    "pacmanCount": 1,
    "maxPlayers": 10,
    "idleShutdownMinutes": 180
  }
}
```

On error, `config` reflects the unchanged active configuration.

See [configuration.md](configuration.md) for all parameters, validation rules, and when changes take effect.

---

## Error Responses

### Method Not Allowed (405)

All endpoints enforce their HTTP method. Using the wrong method returns:

```json
{ "error": "Method not allowed" }
```

### Not Found (404)

Unknown `/admin/*` paths return:

```json
{ "error": "Not found" }
```

### Invalid JSON (400)

`PUT /admin/config` with unparseable body:

```json
{ "ok": false, "error": "Invalid JSON body" }
```

---

## Response Format Summary

All responses are JSON (`Content-Type: application/json`).

| Endpoint | Method | Success | Error Status |
|----------|--------|---------|--------------|
| `/admin/status` | GET | 200 | — |
| `/admin/server/start` | POST | 200 | — |
| `/admin/server/stop` | POST | 200 | — |
| `/admin/round/start` | POST | 200 | 409 |
| `/admin/round/stop` | POST | 200 | 409 |
| `/admin/config` | PUT | 200 | 400 |
