import type { CellType, GameMap } from "./types";

const CHAR_TO_CELL: Record<string, CellType> = {
  "#": "wall",
  ".": "dot",
  o: "power_pellet",
  P: "pacman_spawn",
  G: "ghost_spawn",
  " ": "empty",
};

export function parseCharGrid(grid: string[]): GameMap {
  const height = grid.length;
  const width = height > 0 ? grid[0].length : 0;

  const cells: CellType[][] = grid.map((row) =>
    Array.from(row).map((ch) => CHAR_TO_CELL[ch] ?? "empty")
  );

  return { width, height, cells };
}

export function validateMap(
  map: GameMap
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  let hasPacmanSpawn = false;
  let hasGhostSpawn = false;
  let hasDot = false;

  for (let y = 0; y < map.height; y++) {
    if (map.cells[y].length !== map.width) {
      errors.push(
        `Row ${y} has ${map.cells[y].length} cells, expected ${map.width}`
      );
    }
    for (let x = 0; x < map.cells[y].length; x++) {
      const cell = map.cells[y][x];
      if (cell === "pacman_spawn") hasPacmanSpawn = true;
      if (cell === "ghost_spawn") hasGhostSpawn = true;
      if (cell === "dot") hasDot = true;
    }
  }

  if (!hasPacmanSpawn) errors.push("Map must have at least 1 pacman spawn");
  if (!hasGhostSpawn) errors.push("Map must have at least 1 ghost spawn");
  if (!hasDot) errors.push("Map must have at least 1 dot");

  return { valid: errors.length === 0, errors };
}

// 21x21 playable map
// # = wall, . = dot, o = power pellet, P = pacman spawn, G = ghost spawn, ' ' = empty
export const DEFAULT_MAP: string[] = [
  "#####################",
  "#o...........#.....o#",
  "#.###.#####.#.#####.#",
  "#.#...........#.....#",
  "#.#.###.###.#.#.###.#",
  "#...#.....#.#...#...#",
  "#.###.#G#.#.###.###.#",
  "#.....#G#...........#",
  "#.###.# #.###.#####.#",
  "#.#...#G#.#.........#",
  "#.#.###.###.#.#.###.#",
  "#.................#.#",
  "#.###.###.###.###.#.#",
  "#...#.....#...#.....#",
  "#.#.#.###.#.#.#.###.#",
  "#.#...#.....#...#...#",
  "#.###.#.###.###.#.#.#",
  "#.......#P#.........#",
  "#.#####.# #.#####.#.#",
  "#o.................o#",
  "#####################",
];
