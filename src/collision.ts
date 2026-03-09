import type { GameState, Player } from "./types";
import { DEFAULTS } from "./types";

/**
 * Check dot collisions: if a pacman is on a dot, remove the dot and increment score.
 */
export function checkDotCollisions(state: GameState): GameState {
  const dots = new Set(state.dots);
  const scores = new Map(state.scores);

  for (const [id, player] of state.players) {
    if (player.role !== "pacman" || !player.position) continue;
    if (player.status !== "active") continue;

    const key = `${player.position.x},${player.position.y}`;
    if (dots.has(key)) {
      dots.delete(key);
      scores.set(id, (scores.get(id) ?? 0) + 1);
    }
  }

  return { ...state, dots, scores };
}

/**
 * Check power pellet collisions: if a pacman is on a power pellet,
 * remove it, set all active ghosts to vulnerable, and reset the vulnerability timer.
 */
export function checkPelletCollisions(state: GameState): GameState {
  const powerPellets = new Set(state.powerPellets);
  let consumed = false;

  for (const [_id, player] of state.players) {
    if (player.role !== "pacman" || !player.position) continue;
    if (player.status !== "active") continue;

    const key = `${player.position.x},${player.position.y}`;
    if (powerPellets.has(key)) {
      powerPellets.delete(key);
      consumed = true;
    }
  }

  if (!consumed) {
    return { ...state, powerPellets };
  }

  // Set all active ghosts to vulnerable and reset the timer
  const updatedPlayers = new Map<string, Player>();
  for (const [id, player] of state.players) {
    if (player.role === "ghost" && player.status === "active") {
      updatedPlayers.set(id, { ...player, status: "vulnerable" });
    } else {
      updatedPlayers.set(id, player);
    }
  }

  return {
    ...state,
    powerPellets,
    players: updatedPlayers,
    vulnerabilityTimer: DEFAULTS.powerPelletDuration,
  };
}

/**
 * Check player collisions: pacman vs ghost interactions.
 * - Pacman + active ghost → pacman dies
 * - Pacman + vulnerable ghost → ghost respawning, pacman gets score
 */
export function checkPlayerCollisions(state: GameState): GameState {
  const players = new Map(state.players);
  const scores = new Map(state.scores);
  const respawnTimers = new Map(state.respawnTimers);

  // Collect pacmans and ghosts with positions
  const pacmans: [string, Player][] = [];
  const ghosts: [string, Player][] = [];

  for (const [id, player] of players) {
    if (!player.position) continue;
    if (player.role === "pacman" && player.status === "active") {
      pacmans.push([id, player]);
    } else if (
      player.role === "ghost" &&
      (player.status === "active" || player.status === "vulnerable")
    ) {
      ghosts.push([id, player]);
    }
  }

  for (const [pacId, pacman] of pacmans) {
    for (const [ghostId, ghost] of ghosts) {
      // Check if already processed (ghost may have been eaten by another pacman this tick)
      const currentGhost = players.get(ghostId)!;
      if (
        currentGhost.status !== "active" &&
        currentGhost.status !== "vulnerable"
      )
        continue;

      // Check if current pacman is still active (may have died this tick)
      const currentPacman = players.get(pacId)!;
      if (currentPacman.status !== "active") continue;

      if (
        pacman.position!.x === ghost.position!.x &&
        pacman.position!.y === ghost.position!.y
      ) {
        if (currentGhost.status === "active") {
          // Active ghost kills pacman
          players.set(pacId, { ...currentPacman, status: "dead" });
        } else if (currentGhost.status === "vulnerable") {
          // Pacman eats vulnerable ghost
          players.set(ghostId, { ...currentGhost, status: "respawning" });
          respawnTimers.set(ghostId, DEFAULTS.ghostRespawnDelay);
          scores.set(pacId, (scores.get(pacId) ?? 0) + 1);
        }
      }
    }
  }

  return { ...state, players, scores, respawnTimers };
}

/**
 * Find ghost spawn positions from the map.
 */
function findGhostSpawns(state: GameState): { x: number; y: number }[] {
  const spawns: { x: number; y: number }[] = [];
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.cells[y].length; x++) {
      if (state.map.cells[y][x] === "ghost_spawn") {
        spawns.push({ x, y });
      }
    }
  }
  return spawns;
}

/**
 * Update timers: decrement vulnerability timer and revert ghosts when it expires.
 * Also handle respawn timers for ghosts.
 */
export function updateTimers(state: GameState): GameState {
  let { vulnerabilityTimer } = state;
  let players = state.players;
  const respawnTimers = new Map(state.respawnTimers);

  // Handle respawn timers
  let playersUpdated = false;
  const ghostSpawns = findGhostSpawns(state);
  let spawnIdx = 0;

  for (const [playerId, timer] of respawnTimers) {
    const newTimer = timer - 1;
    if (newTimer <= 0) {
      // Respawn ghost at ghost spawn
      if (!playersUpdated) {
        players = new Map(players);
        playersUpdated = true;
      }
      const player = players.get(playerId);
      if (player && player.status === "respawning") {
        const spawnPos = ghostSpawns.length > 0 ? ghostSpawns[spawnIdx % ghostSpawns.length] : { x: 0, y: 0 };
        spawnIdx++;
        players.set(playerId, {
          ...player,
          status: "active",
          position: { ...spawnPos },
          direction: null,
        });
      }
      respawnTimers.delete(playerId);
    } else {
      respawnTimers.set(playerId, newTimer);
    }
  }

  const respawnTimersChanged = state.respawnTimers.size > 0;

  if (vulnerabilityTimer <= 0) {
    if (playersUpdated || respawnTimersChanged) {
      return { ...state, players, respawnTimers };
    }
    return state;
  }

  vulnerabilityTimer -= 1;

  if (vulnerabilityTimer > 0) {
    return { ...state, vulnerabilityTimer, players, respawnTimers };
  }

  // Timer expired — revert all vulnerable ghosts to active
  if (!playersUpdated) {
    players = new Map(players);
  }
  for (const [id, player] of players) {
    if (player.role === "ghost" && player.status === "vulnerable") {
      players.set(id, { ...player, status: "active" });
    }
  }

  return { ...state, vulnerabilityTimer: 0, players, respawnTimers };
}
