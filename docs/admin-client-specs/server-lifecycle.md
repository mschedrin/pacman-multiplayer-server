# Server Lifecycle

## States

The server has three states:

```
stopped ──▶ lobby ──▶ playing ──▶ lobby ──▶ ...
   ▲           │         │          │
   │           ▼         ▼          │
   └───────────┴─────────┴──────────┘
            (server/stop)
```

| State | Description | WebSocket connections | Player actions |
|-------|-------------|----------------------|----------------|
| `stopped` | Server is idle. No connections accepted. | Rejected with error + close | None |
| `lobby` | Accepting connections. Players join and wait. | Accepted | `join` |
| `playing` | Round in progress. Game loop running. | Rejected with error + close | `join` (rejected), `input` |

## State Transitions

| Transition | Trigger | API Call |
|------------|---------|----------|
| stopped → lobby | Admin starts server | `POST /admin/server/start` |
| lobby → playing | Admin starts round | `POST /admin/round/start` |
| playing → lobby | Round ends naturally (all dots eaten or all pacmans dead) | Automatic |
| playing → lobby | Admin stops round | `POST /admin/round/stop` |
| any → stopped | Admin stops server | `POST /admin/server/stop` |
| lobby/playing → stopped | Auto-shutdown (0 players for idle timeout) | Automatic (alarm) |

## Operational Workflows

### Starting a Session

1. `POST /admin/server/start` — server moves to `lobby`
2. Wait for players to connect (monitor with `GET /admin/status`)
3. Optionally adjust config with `PUT /admin/config`
4. `POST /admin/round/start` — round begins (needs 2+ players)

### Running Multiple Rounds

After a round ends (naturally or via `/admin/round/stop`), the server returns to `lobby`. All connected players stay connected. To play again:

1. `GET /admin/status` — check player count
2. `POST /admin/round/start` — start next round

Roles are re-randomized each round.

### Ending a Session

Option A — graceful:
1. Wait for the round to end naturally
2. `POST /admin/server/stop` — disconnects all players

Option B — immediate:
1. `POST /admin/server/stop` — force-ends any active round and disconnects everyone

### Emergency: Force-Stop a Round

If a round is stuck or needs to be restarted:

1. `POST /admin/round/stop` — ends the round, returns to lobby
2. Players stay connected and can play again immediately
3. `POST /admin/round/start` — start a new round

## Auto-Shutdown

The server automatically stops itself if no players are connected for a configurable period (default: 180 minutes / 3 hours).

- The idle timer starts when the last player disconnects
- Any new player connection cancels the timer
- When the timer fires, the server transitions to `stopped`
- The timeout is configurable via `PUT /admin/config` with `idleShutdownMinutes`
- This applies in both `lobby` and `playing` states (though `playing` with 0 players means all pacmans disconnected and the round likely ended)

To restart after auto-shutdown: `POST /admin/server/start`.

## Hibernation Recovery

The server runs on Cloudflare Durable Objects, which may hibernate (evict from memory) during inactivity. If the Durable Object hibernates while in `playing` state:

- The game loop (`setInterval`) is lost and cannot be recovered
- On wake, the state downgrades from `playing` to `lobby`
- Connected players receive a `round_end` (result: `"cancelled"`) followed by a `lobby` update
- The admin can start a new round normally

This is an edge case — it typically only happens if there is no WebSocket activity for an extended period.
