# Phase 2: Game Loop — Map, Movement, Collisions, Rounds

This phase makes the game playable. At round start, the server loads a map from YAML (walls, dots, power pellets, spawn points), randomly assigns players as pacman or ghost, and kicks off a tick-based game loop inside the Durable Object. Each tick, the server processes player direction inputs, moves players one grid cell, and runs collision detection: pacman eating dots scores points, power pellets make ghosts vulnerable, pacman touching a normal ghost kills the pacman, and pacman touching a vulnerable ghost eats the ghost (who respawns after a delay). Full game state is broadcast to all clients every tick. The round ends when all dots are eaten (pacman wins) or all pacmans are dead (ghosts win), at which point results are broadcast and everyone returns to lobby. For now, rounds are started/stopped by calling methods directly on the DO — the admin HTTP API comes in Phase 3.

## Deliverables

- [ ] Map loader — parse YAML map definition (walls, dots, power pellets, pacman spawns, ghost house spawn); validate that required spawn points exist
- [ ] Default map YAML file shipped with the project
- [ ] Role assignment — configurable pacman count (default 1), rest are ghosts, randomly assigned at round start
- [ ] `round_start` message — send map, assigned role, player list, and config to each client
- [ ] Tick-based game loop via `setInterval` at configurable tick rate (default 20/sec)
- [ ] `input` message handling — client sends direction (`up`/`down`/`left`/`right`), server stores it for next tick
- [ ] Grid movement — move player one cell per tick in their current direction; ignore moves into walls; players stationary until first input
- [ ] Collision detection per tick:
  - Pacman + dot → consume dot, increment score
  - Pacman + power pellet → ghosts become vulnerable for N ticks (configurable)
  - Pacman + ghost (normal) → pacman dies (no respawn)
  - Pacman + ghost (vulnerable) → ghost eaten, respawns at ghost house after N ticks (configurable)
- [ ] Player statuses: active, vulnerable (ghost during power pellet), dead, respawning
- [ ] `state` broadcast every tick — players with positions/statuses, remaining dots, remaining power pellets, scores
- [ ] Round end conditions: all dots eaten (pacman wins), all pacmans dead (ghosts win), all pacmans disconnected (ghosts win)
- [ ] `round_end` message — result (`pacman` or `ghosts`) and final scores
- [ ] Return to lobby state after round ends; scores reset

## Acceptance

Start a round with 3+ players, see role assignments, move around the map, eat dots and see score go up, grab a power pellet and eat a vulnerable ghost, watch a ghost respawn, have pacman get eaten by a normal ghost, see round end with correct winner, land back in lobby ready for another round.
