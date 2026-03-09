# Configuration

Game configuration can be updated at runtime via `PUT /admin/config`. Changes are persisted in Durable Object storage and survive server restarts.

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tickRate` | integer | `20` | Game ticks per second. Higher = faster gameplay. |
| `powerPelletDuration` | integer | `100` | Ticks that ghosts remain vulnerable after a power pellet is eaten. At 20 tps, 100 ticks = 5 seconds. |
| `ghostRespawnDelay` | integer | `60` | Ticks before an eaten ghost respawns. At 20 tps, 60 ticks = 3 seconds. |
| `pacmanCount` | integer | `1` | Number of players assigned the pacman role. Rest become ghosts. |
| `maxPlayers` | integer | `10` | Maximum concurrent players. New connections are rejected when full. |
| `idleShutdownMinutes` | number | `180` | Minutes with 0 players before auto-shutdown. Does not need to be an integer. |

## Validation Rules

All parameters must be:
- **Positive numbers** — zero and negative values are rejected
- **Finite** — `Infinity` and `NaN` are rejected
- **Integers** (except `idleShutdownMinutes`) — `tickRate`, `powerPelletDuration`, `ghostRespawnDelay`, `pacmanCount`, and `maxPlayers` must be whole numbers

Unknown keys are rejected. The entire update fails if any field is invalid — no partial application on validation error.

## Updating Config

Send a partial object with only the fields you want to change:

```bash
# Change just the tick rate
curl -X PUT https://<server-host>/admin/config \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"tickRate": 30}'
```

Overrides are **cumulative** — each update merges with previously stored overrides. To reset a field to its default, you would need to explicitly set it back to the default value.

### Example: Setting Up for a Large Game

```bash
curl -X PUT https://<server-host>/admin/config \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{
    "maxPlayers": 20,
    "pacmanCount": 3,
    "tickRate": 15,
    "powerPelletDuration": 150
  }'
```

## When Changes Take Effect

| Server State | Behavior |
|--------------|----------|
| `stopped` or `lobby` | Changes apply immediately to `activeConfig` |
| `playing` | Changes are **stored** but the current round keeps its config. Changes apply at the next round start. |

This means you can safely update config mid-round to prepare for the next round without disrupting the current game.

## Reading Current Config

Use `GET /admin/status` to see the active configuration:

```json
{
  "roundState": "lobby",
  "players": [...],
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

The `config` field always reflects the fully merged config (defaults + overrides).

## Practical Notes

- **tickRate** affects game speed directly. 20 tps is a good default. Lower values (10-15) make the game easier; higher values (30+) make it frantic.
- **powerPelletDuration** and **ghostRespawnDelay** are measured in ticks, not seconds. Convert with: `seconds = ticks / tickRate`.
- **pacmanCount** should be less than the total player count. If `pacmanCount >= player count`, all players become pacman and there are no ghosts (likely not fun).
- **maxPlayers** is enforced at join time. Reducing it below the current player count does not kick existing players.
- **idleShutdownMinutes** controls the auto-shutdown alarm. Set higher for longer hackathon sessions. The timer only starts when the last player disconnects.
