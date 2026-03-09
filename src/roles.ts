import type { Role } from "./types";

/**
 * Randomly assign roles to players. `pacmanCount` players become pacman, the rest become ghosts.
 * If pacmanCount >= playerIds.length, all players become pacman.
 */
export function assignRoles(
  playerIds: string[],
  pacmanCount: number
): Map<string, Role> {
  const roles = new Map<string, Role>();

  // Clamp pacmanCount to the number of players
  const actualPacmanCount = Math.min(pacmanCount, playerIds.length);

  // Shuffle a copy of the array to pick random pacmans
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (let i = 0; i < shuffled.length; i++) {
    roles.set(shuffled[i], i < actualPacmanCount ? "pacman" : "ghost");
  }

  return roles;
}
