# Phase 2: Game Loop — Map, Movement, Collisions, Rounds

## Overview

Make the game playable. Load a hardcoded map, assign roles, run a 20 tick/sec server-authoritative game loop with grid movement and collision detection. Round starts from lobby, ends when all dots eaten or all pacmans dead, then returns to lobby.

PRD: `docs/specs/prd-phase2-game-loop.md`

## Context

- **Depends on:** Phase 1 complete (Worker + DO + WebSocket + lobby)
- **Files from Phase 1:** `src/index.ts` (Worker), `src/game-room.ts` (DO), `src/types.ts`
- **WebSocket pattern:** Hibernatable WebSockets — DO hibernates in lobby, `setInterval` during active rounds keeps DO awake
- **Game loop:** `setInterval` at configurable tick rate (default 50ms = 20 ticks/sec)
- **Map format:** Hardcoded TypeScript constant (character grid) — no YAML dependency
- **Structure:** Flat `src/` — add `game-loop.ts`, `map.ts`, `collision.ts`, `roles.ts` alongside existing files

## Development Approach

- **Testing approach**: Code first, then tests
- Complete each task fully before moving to the next
- Game logic functions (movement, collision) should be pure functions — easy to unit test
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**
- **CRITICAL: update this plan file when scope changes during implementation**

## Progress Tracking

- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## Implementation Steps

### Task 1: Map data structure and default map

**Files:**
- Create: `src/map.ts`
- Modify: `src/types.ts`
- Create: `test/map.test.ts`

- [ ] Define `CellType` enum/union: `'wall' | 'empty' | 'dot' | 'power_pellet' | 'pacman_spawn' | 'ghost_spawn'`
- [ ] Define `GameMap` type: `{ width: number, height: number, cells: CellType[][] }`
- [ ] Implement `parseCharGrid(grid: string[]): GameMap` — convert character grid (e.g., `#` = wall, `.` = dot, `o` = power pellet, `P` = pacman spawn, `G` = ghost spawn, ` ` = empty) into a `GameMap`
- [ ] Define `DEFAULT_MAP` as a `string[]` constant — a simple playable map (~20x20) with walls forming corridors, dots, 4 power pellets in corners, 1 pacman spawn, and a ghost house with spawn points
- [ ] Implement `validateMap(map: GameMap): { valid: boolean, errors: string[] }` — check: at least 1 pacman spawn, at least 1 ghost spawn, map is rectangular, has at least 1 dot
- [ ] Write tests for parseCharGrid (character mapping, dimensions)
- [ ] Write tests for validateMap (missing spawns → error, no dots → error, valid map → OK)
- [ ] Write test that DEFAULT_MAP passes validation
- [ ] Run tests — must pass before next task

### Task 2: Role assignment

**Files:**
- Create: `src/roles.ts`
- Modify: `src/types.ts`
- Create: `test/roles.test.ts`

- [ ] Define `Role` type: `'pacman' | 'ghost'`
- [ ] Define `Direction` type: `'up' | 'down' | 'left' | 'right'`
- [ ] Extend `Player` type with: `role: Role | null`, `position: { x: number, y: number }`, `direction: Direction | null`, `status: PlayerStatus`
- [ ] Define `PlayerStatus`: `'lobby' | 'active' | 'vulnerable' | 'dead' | 'respawning'`
- [ ] Implement `assignRoles(playerIds: string[], pacmanCount: number): Map<string, Role>` — randomly assign pacmanCount players as pacman, rest as ghosts
- [ ] Write tests for role assignment (correct counts, handles pacmanCount ≥ playerCount, handles single player)
- [ ] Run tests — must pass before next task

### Task 3: Round start flow

**Files:**
- Modify: `src/game-room.ts`
- Modify: `src/types.ts`

- [ ] Add round state to DO: `'lobby' | 'playing'`
- [ ] Define `GameState` interface (see Technical Details below)
- [ ] Implement `startRound()` method on DO: validate ≥2 players in lobby, parse DEFAULT_MAP, assign roles, place pacmans at pacman spawns, place ghosts at ghost spawns, initialize dot/pellet Sets from map
- [ ] Define `RoundStartMessage { type: 'round_start', map: { width, height, cells }, role: Role, players: { id, name, role, position }[], config: { tickRate, powerPelletDuration, ghostRespawnDelay } }`
- [ ] Send `round_start` to each client with the map, their assigned role, all player info, and game config
- [ ] Reject new WebSocket connections during active round with `error` message
- [ ] Write tests for round start (roles assigned correctly, round_start sent to all, each client gets their own role, state transitions to 'playing')
- [ ] Write tests for rejection during round (new connection → error)
- [ ] Write tests for insufficient players (< 2 → error, round stays in lobby)
- [ ] Run tests — must pass before next task

### Task 4: Input handling

**Files:**
- Modify: `src/game-room.ts`

- [ ] Handle `input` message type in `webSocketMessage()`: `{ type: 'input', direction: 'up' | 'down' | 'left' | 'right' }`
- [ ] Store latest direction per player (overwrites previous — only latest direction matters per tick)
- [ ] Ignore `input` messages when round is not active (no error, just drop)
- [ ] Ignore `input` from dead players
- [ ] Validate direction value — send `error` for invalid values
- [ ] Write tests for input handling (valid direction stored, invalid direction → error, input outside round → ignored, dead player input → ignored)
- [ ] Run tests — must pass before next task

### Task 5: Game loop and grid movement

**Files:**
- Create: `src/game-loop.ts`
- Modify: `src/game-room.ts`
- Create: `test/game-loop.test.ts`

- [ ] Implement `processMovement(state: GameState): GameState` as a pure function — for each active/vulnerable player: if they have a direction, compute target cell; if target is not a wall, move player there; otherwise stay in place
- [ ] Implement `tick(state: GameState): GameState` as a pure function — calls processMovement, then collision detection (Task 6-7), then timer updates, then end condition checks
- [ ] Start `setInterval(runTick, 1000 / tickRate)` in DO when round begins — each tick: call `tick()`, update state, broadcast
- [ ] Stop interval (`clearInterval`) when round ends — DO becomes hibernation-eligible
- [ ] Define `StateMessage { type: 'state', tick: number, players: { id, name, role, position, status, score }[], dots: [number, number][], powerPellets: [number, number][], timeElapsed: number }`
- [ ] Broadcast `state` message to all connected clients every tick
- [ ] Write tests for processMovement (move in direction, wall blocking, no direction → stationary, dead players don't move)
- [ ] Write tests for tick function orchestration
- [ ] Run tests — must pass before next task

### Task 6: Collision detection — dots and power pellets

**Files:**
- Create: `src/collision.ts`
- Modify: `src/game-loop.ts`
- Create: `test/collision.test.ts`

- [ ] Implement `checkDotCollisions(state: GameState): GameState` — for each pacman: if position matches a dot, remove dot and increment score
- [ ] Implement `checkPelletCollisions(state: GameState): GameState` — for each pacman: if position matches a power pellet, remove pellet, set all active ghosts to `vulnerable`, reset vulnerability timer to configured duration (default 100 ticks)
- [ ] Implement `updateTimers(state: GameState): GameState` — decrement vulnerability timer; when it hits 0, set all `vulnerable` ghosts back to `active`
- [ ] Wire collision functions into `tick()` pipeline
- [ ] Write tests for dot consumption (dot removed from Set, score incremented, non-pacman doesn't consume)
- [ ] Write tests for power pellet (ghosts become vulnerable, timer set correctly)
- [ ] Write tests for vulnerability expiry (timer → 0, ghosts back to active)
- [ ] Run tests — must pass before next task

### Task 7: Collision detection — pacman vs ghost

**Files:**
- Modify: `src/collision.ts`
- Modify: `test/collision.test.ts`

- [ ] Implement `checkPlayerCollisions(state: GameState): GameState` — check all pacman-ghost position overlaps:
  - Pacman + active ghost → pacman status = `dead`
  - Pacman + vulnerable ghost → ghost status = `respawning`, start respawn timer (default 60 ticks), increment pacman score
- [ ] Implement respawn timer in `updateTimers()` — decrement each respawning ghost's timer; when expired, move ghost to ghost spawn position, set status to `active`
- [ ] Wire into `tick()` pipeline (after dot/pellet collisions)
- [ ] Write tests for pacman death (pacman hits active ghost → dead, pacman stops moving)
- [ ] Write tests for ghost eating (pacman hits vulnerable ghost → ghost respawning, pacman score incremented)
- [ ] Write tests for ghost respawn (timer counts down, ghost teleports to spawn, becomes active)
- [ ] Write tests for edge case: two pacmans hit same ghost simultaneously
- [ ] Run tests — must pass before next task

### Task 8: Round end conditions and lobby return

**Files:**
- Modify: `src/game-loop.ts`
- Modify: `src/game-room.ts`

- [ ] Implement `checkRoundEnd(state: GameState): { ended: boolean, result?: 'pacman' | 'ghosts' }` — check after each tick:
  - All dots eaten → `{ ended: true, result: 'pacman' }`
  - All pacmans dead → `{ ended: true, result: 'ghosts' }`
- [ ] Handle pacman disconnect mid-round: treat disconnected pacman as dead; if all pacmans dead/disconnected → ghosts win
- [ ] Define `RoundEndMessage { type: 'round_end', result: 'pacman' | 'ghosts', scores: Record<string, number> }`
- [ ] On round end: stop game loop (`clearInterval`), broadcast `round_end` with result and final scores
- [ ] After round end: reset all player statuses to `lobby`, clear game state, broadcast `lobby` message
- [ ] Wire `checkRoundEnd` into `tick()` — if ended, trigger end flow instead of broadcasting state
- [ ] Write tests for all-dots-eaten end condition
- [ ] Write tests for all-pacmans-dead end condition
- [ ] Write tests for pacman-disconnect end condition
- [ ] Write tests for return-to-lobby flow (statuses reset, lobby broadcast sent)
- [ ] Run tests — must pass before next task

### Task 9: Verify acceptance criteria

- [ ] Verify: round starts with role assignments and map sent to clients
- [ ] Verify: players move on the grid, walls block movement
- [ ] Verify: dots consumed → score increases
- [ ] Verify: power pellet → ghosts vulnerable → can be eaten → respawn
- [ ] Verify: pacman + active ghost → pacman dies
- [ ] Verify: all dots eaten → pacman wins, round ends
- [ ] Verify: all pacmans dead → ghosts win, round ends
- [ ] Verify: after round end, players return to lobby
- [ ] Run full test suite: `npx vitest run`
- [ ] Run linter — all issues must be fixed

### Task 10: Update documentation

- [ ] Update `CLAUDE.md` with new file descriptions and game loop architecture
- [ ] Update `README.md` if any protocol details changed

## Technical Details

**Map character legend:**
```
# = wall
. = dot
o = power pellet
P = pacman spawn
G = ghost spawn
  = empty (space)
```

**Game state per round:**
```typescript
interface GameState {
  map: GameMap;
  players: Map<string, Player>;
  dots: Set<string>;           // "x,y" keys for O(1) lookup
  powerPellets: Set<string>;   // "x,y" keys
  scores: Map<string, number>;
  vulnerabilityTimer: number;  // ticks remaining, 0 = inactive
  respawnTimers: Map<string, number>; // playerId → ticks remaining
  tick: number;                // current tick count
}
```

**Tick processing order:**
1. Apply queued direction inputs to players
2. Move players one cell (wall check)
3. Check dot/pellet collisions
4. Check pacman-ghost collisions
5. Update timers (vulnerability, respawn)
6. Check round end conditions
7. Broadcast `state` (or `round_end` if finished)

**Config defaults (hardcoded until Phase 3 adds config system):**
```typescript
const DEFAULTS = {
  tickRate: 20,              // ticks per second
  powerPelletDuration: 100,  // ticks (~5 sec)
  ghostRespawnDelay: 60,     // ticks (~3 sec)
};
```

**Hybrid hibernation pattern:**
- Round starts → `setInterval` → DO stays awake for game loop
- Round ends → `clearInterval` → DO can hibernate after idle timeout
- Hibernatable WebSocket API used throughout (no switching between APIs)

## Post-Completion

**Manual verification:**
- Connect 3+ WebSocket clients, start a round, play through dot eating, power pellet, ghost interactions, and round end
- Verify smooth 20 tick/sec state updates
- Test all collision types manually
- Verify round end conditions and return to lobby

**Deferred to Phase 3:**
- Admin API endpoints to start/stop rounds (currently called directly on DO)
- YAML config file with runtime overrides
- Auto-shutdown alarm
