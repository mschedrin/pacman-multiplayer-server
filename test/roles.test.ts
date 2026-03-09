import { describe, it, expect } from "vitest";
import { assignRoles } from "../src/roles";

describe("assignRoles", () => {
  it("assigns correct number of pacmans and ghosts", () => {
    const playerIds = ["a", "b", "c", "d", "e"];
    const roles = assignRoles(playerIds, 1);

    expect(roles.size).toBe(5);

    const pacmans = [...roles.values()].filter((r) => r === "pacman");
    const ghosts = [...roles.values()].filter((r) => r === "ghost");

    expect(pacmans.length).toBe(1);
    expect(ghosts.length).toBe(4);
  });

  it("assigns multiple pacmans when pacmanCount > 1", () => {
    const playerIds = ["a", "b", "c", "d"];
    const roles = assignRoles(playerIds, 2);

    const pacmans = [...roles.values()].filter((r) => r === "pacman");
    const ghosts = [...roles.values()].filter((r) => r === "ghost");

    expect(pacmans.length).toBe(2);
    expect(ghosts.length).toBe(2);
  });

  it("handles pacmanCount >= playerCount (all become pacman)", () => {
    const playerIds = ["a", "b"];
    const roles = assignRoles(playerIds, 5);

    const pacmans = [...roles.values()].filter((r) => r === "pacman");
    expect(pacmans.length).toBe(2);
    expect(roles.size).toBe(2);
  });

  it("handles single player as pacman", () => {
    const playerIds = ["solo"];
    const roles = assignRoles(playerIds, 1);

    expect(roles.size).toBe(1);
    expect(roles.get("solo")).toBe("pacman");
  });

  it("handles single player as ghost (pacmanCount = 0)", () => {
    const playerIds = ["solo"];
    const roles = assignRoles(playerIds, 0);

    expect(roles.size).toBe(1);
    expect(roles.get("solo")).toBe("ghost");
  });

  it("assigns a role to every player", () => {
    const playerIds = ["a", "b", "c", "d", "e", "f"];
    const roles = assignRoles(playerIds, 2);

    for (const id of playerIds) {
      expect(roles.has(id)).toBe(true);
      expect(["pacman", "ghost"]).toContain(roles.get(id));
    }
  });

  it("handles empty player list", () => {
    const roles = assignRoles([], 1);
    expect(roles.size).toBe(0);
  });

  it("produces randomized assignments across multiple runs", () => {
    const playerIds = ["a", "b", "c", "d", "e"];
    const firstPacmans = new Set<string>();

    // Run 20 times and collect who gets pacman - with random shuffling,
    // we should see different players assigned over enough runs
    for (let i = 0; i < 20; i++) {
      const roles = assignRoles(playerIds, 1);
      for (const [id, role] of roles) {
        if (role === "pacman") firstPacmans.add(id);
      }
    }

    // With 5 players and 20 runs, it's extremely unlikely that only 1 player
    // gets pacman every time (probability ~ (1/5)^19 ≈ 0)
    expect(firstPacmans.size).toBeGreaterThan(1);
  });
});
