import { describe, it, expect } from "vitest";
import { parseCharGrid, validateMap, DEFAULT_MAP } from "../src/map";

describe("parseCharGrid", () => {
  it("maps characters to correct cell types", () => {
    const grid = ["#. ", "oPG"];
    const map = parseCharGrid(grid);

    expect(map.cells[0][0]).toBe("wall");
    expect(map.cells[0][1]).toBe("dot");
    expect(map.cells[0][2]).toBe("empty");
    expect(map.cells[1][0]).toBe("power_pellet");
    expect(map.cells[1][1]).toBe("pacman_spawn");
    expect(map.cells[1][2]).toBe("ghost_spawn");
  });

  it("returns correct dimensions", () => {
    const grid = ["###", "#.#", "###"];
    const map = parseCharGrid(grid);

    expect(map.width).toBe(3);
    expect(map.height).toBe(3);
    expect(map.cells.length).toBe(3);
    expect(map.cells[0].length).toBe(3);
  });

  it("handles empty grid", () => {
    const map = parseCharGrid([]);
    expect(map.width).toBe(0);
    expect(map.height).toBe(0);
    expect(map.cells.length).toBe(0);
  });

  it("treats unknown characters as empty", () => {
    const grid = ["?X!"];
    const map = parseCharGrid(grid);

    expect(map.cells[0][0]).toBe("empty");
    expect(map.cells[0][1]).toBe("empty");
    expect(map.cells[0][2]).toBe("empty");
  });
});

describe("validateMap", () => {
  it("returns valid for a correct map", () => {
    const grid = ["#.#", "#P#", "#G#"];
    const map = parseCharGrid(grid);
    const result = validateMap(map);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns error when missing pacman spawn", () => {
    const grid = ["#.#", "# #", "#G#"];
    const map = parseCharGrid(grid);
    const result = validateMap(map);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Map must have at least 1 pacman spawn");
  });

  it("returns error when missing ghost spawn", () => {
    const grid = ["#.#", "#P#", "# #"];
    const map = parseCharGrid(grid);
    const result = validateMap(map);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Map must have at least 1 ghost spawn");
  });

  it("returns error when missing dots", () => {
    const grid = ["###", "#P#", "#G#"];
    const map = parseCharGrid(grid);
    const result = validateMap(map);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Map must have at least 1 dot");
  });

  it("returns multiple errors at once", () => {
    const grid = ["###", "# #", "###"];
    const map = parseCharGrid(grid);
    const result = validateMap(map);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });

  it("detects non-rectangular maps", () => {
    const grid = ["#.#", "#P#G", "#G#"];
    const map = parseCharGrid(grid);
    // width is taken from first row (3), but row 1 has 4 cells
    const result = validateMap(map);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Row 1")
    );
  });
});

describe("DEFAULT_MAP", () => {
  it("passes validation", () => {
    const map = parseCharGrid(DEFAULT_MAP);
    const result = validateMap(map);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("is rectangular", () => {
    const width = DEFAULT_MAP[0].length;
    for (const row of DEFAULT_MAP) {
      expect(row.length).toBe(width);
    }
  });

  it("has 4 power pellets", () => {
    const map = parseCharGrid(DEFAULT_MAP);
    let count = 0;
    for (const row of map.cells) {
      for (const cell of row) {
        if (cell === "power_pellet") count++;
      }
    }
    expect(count).toBe(4);
  });
});
