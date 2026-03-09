import type { GameState, GameConfig, Player, GameMap } from "./types";
import { checkDotCollisions, checkPelletCollisions, checkPlayerCollisions, updateTimers } from "./collision";

/**
 * Check if a cell at (x, y) is walkable (not a wall and within bounds).
 */
function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (y < 0 || y >= map.height || x < 0 || x >= map.width) {
    return false;
  }
  return map.cells[y][x] !== "wall";
}

/**
 * Process movement for all active/vulnerable players.
 * Pure function: returns a new GameState with updated positions.
 */
export function processMovement(state: GameState): GameState {
  const updatedPlayers = new Map<string, Player>();

  for (const [id, player] of state.players) {
    if (
      player.status !== "active" &&
      player.status !== "vulnerable"
    ) {
      // Dead, respawning, or lobby players don't move
      updatedPlayers.set(id, player);
      continue;
    }

    if (!player.direction || !player.position) {
      // No direction set or no position — stay in place
      updatedPlayers.set(id, player);
      continue;
    }

    let targetX = player.position.x;
    let targetY = player.position.y;

    switch (player.direction) {
      case "up":
        targetY -= 1;
        break;
      case "down":
        targetY += 1;
        break;
      case "left":
        targetX -= 1;
        break;
      case "right":
        targetX += 1;
        break;
    }

    if (isWalkable(state.map, targetX, targetY)) {
      updatedPlayers.set(id, {
        ...player,
        position: { x: targetX, y: targetY },
      });
    } else {
      // Wall blocks movement — stay in place
      updatedPlayers.set(id, player);
    }
  }

  return { ...state, players: updatedPlayers };
}

/**
 * Check if the round should end.
 * - All dots eaten → pacman wins
 * - All pacmans dead → ghosts win
 */
export function checkRoundEnd(state: GameState): { ended: boolean; result?: "pacman" | "ghosts" } {
  // All dots eaten → pacman wins
  if (state.dots.size === 0) {
    return { ended: true, result: "pacman" };
  }

  // All pacmans dead → ghosts win
  let allPacmansDead = true;
  for (const [, player] of state.players) {
    if (player.role === "pacman" && player.status !== "dead") {
      allPacmansDead = false;
      break;
    }
  }

  if (allPacmansDead) {
    return { ended: true, result: "ghosts" };
  }

  return { ended: false };
}

/**
 * Run a single game tick. Pure function.
 */
export function tick(state: GameState, config: GameConfig): GameState {
  let next = { ...state, tick: state.tick + 1 };
  next = processMovement(next);
  next = checkDotCollisions(next);
  next = checkPelletCollisions(next, config);
  next = checkPlayerCollisions(next, config);
  next = updateTimers(next);
  return next;
}
