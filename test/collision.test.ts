import { describe, it, expect } from "vitest";
import { checkDotCollisions, checkPelletCollisions, checkPlayerCollisions, updateTimers } from "../src/collision";
import type { GameState, Player, GameMap } from "../src/types";
import { DEFAULTS } from "../src/types";

const TEST_MAP: GameMap = {
  width: 5,
  height: 5,
  cells: [
    ["wall", "wall", "wall", "wall", "wall"],
    ["wall", "pacman_spawn", "empty", "dot", "wall"],
    ["wall", "empty", "wall", "empty", "wall"],
    ["wall", "ghost_spawn", "dot", "empty", "wall"],
    ["wall", "wall", "wall", "wall", "wall"],
  ],
};

function makePlayer(overrides: Partial<Player> & { id: string }): Player {
  return {
    name: overrides.name ?? overrides.id,
    status: "active",
    role: "pacman",
    position: { x: 1, y: 1 },
    direction: null,
    ...overrides,
  };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    map: TEST_MAP,
    players: new Map(),
    dots: new Set(["3,1", "2,3"]),
    powerPellets: new Set(),
    scores: new Map(),
    vulnerabilityTimer: 0,
    respawnTimers: new Map(),
    tick: 0,
    ...overrides,
  };
}

describe("checkDotCollisions", () => {
  it("removes dot and increments score when pacman is on a dot", () => {
    const pacman = makePlayer({ id: "p1", position: { x: 3, y: 1 }, role: "pacman" });
    const state = makeGameState({
      players: new Map([["p1", pacman]]),
      scores: new Map([["p1", 0]]),
    });

    const result = checkDotCollisions(state);
    expect(result.dots.has("3,1")).toBe(false);
    expect(result.scores.get("p1")).toBe(1);
  });

  it("increments existing score", () => {
    const pacman = makePlayer({ id: "p1", position: { x: 3, y: 1 }, role: "pacman" });
    const state = makeGameState({
      players: new Map([["p1", pacman]]),
      scores: new Map([["p1", 5]]),
    });

    const result = checkDotCollisions(state);
    expect(result.scores.get("p1")).toBe(6);
  });

  it("does nothing when pacman is not on a dot", () => {
    const pacman = makePlayer({ id: "p1", position: { x: 1, y: 1 }, role: "pacman" });
    const state = makeGameState({
      players: new Map([["p1", pacman]]),
      scores: new Map([["p1", 0]]),
    });

    const result = checkDotCollisions(state);
    expect(result.dots.size).toBe(2);
    expect(result.scores.get("p1")).toBe(0);
  });

  it("ghost does not consume dots", () => {
    const ghost = makePlayer({ id: "g1", position: { x: 3, y: 1 }, role: "ghost" });
    const state = makeGameState({
      players: new Map([["g1", ghost]]),
      scores: new Map([["g1", 0]]),
    });

    const result = checkDotCollisions(state);
    expect(result.dots.has("3,1")).toBe(true);
    expect(result.scores.get("g1")).toBe(0);
  });

  it("dead pacman does not consume dots", () => {
    const pacman = makePlayer({ id: "p1", position: { x: 3, y: 1 }, role: "pacman", status: "dead" });
    const state = makeGameState({
      players: new Map([["p1", pacman]]),
      scores: new Map([["p1", 0]]),
    });

    const result = checkDotCollisions(state);
    expect(result.dots.has("3,1")).toBe(true);
  });

  it("multiple pacmans can consume different dots in same tick", () => {
    const p1 = makePlayer({ id: "p1", position: { x: 3, y: 1 }, role: "pacman" });
    const p2 = makePlayer({ id: "p2", position: { x: 2, y: 3 }, role: "pacman" });
    const state = makeGameState({
      players: new Map([["p1", p1], ["p2", p2]]),
      scores: new Map([["p1", 0], ["p2", 0]]),
    });

    const result = checkDotCollisions(state);
    expect(result.dots.size).toBe(0);
    expect(result.scores.get("p1")).toBe(1);
    expect(result.scores.get("p2")).toBe(1);
  });
});

describe("checkPelletCollisions", () => {
  it("removes power pellet and makes ghosts vulnerable", () => {
    const pacman = makePlayer({ id: "p1", position: { x: 2, y: 2 }, role: "pacman" });
    const ghost = makePlayer({ id: "g1", position: { x: 3, y: 3 }, role: "ghost", status: "active" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      powerPellets: new Set(["2,2"]),
    });

    const result = checkPelletCollisions(state, DEFAULTS);
    expect(result.powerPellets.has("2,2")).toBe(false);
    expect(result.players.get("g1")!.status).toBe("vulnerable");
    expect(result.vulnerabilityTimer).toBe(DEFAULTS.powerPelletDuration);
  });

  it("sets vulnerability timer correctly", () => {
    const pacman = makePlayer({ id: "p1", position: { x: 2, y: 2 }, role: "pacman" });
    const ghost = makePlayer({ id: "g1", position: { x: 3, y: 3 }, role: "ghost" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      powerPellets: new Set(["2,2"]),
    });

    const result = checkPelletCollisions(state, DEFAULTS);
    expect(result.vulnerabilityTimer).toBe(DEFAULTS.powerPelletDuration);
  });

  it("does not affect dead or respawning ghosts", () => {
    const pacman = makePlayer({ id: "p1", position: { x: 2, y: 2 }, role: "pacman" });
    const deadGhost = makePlayer({ id: "g1", position: { x: 3, y: 3 }, role: "ghost", status: "dead" });
    const respawning = makePlayer({ id: "g2", position: { x: 1, y: 3 }, role: "ghost", status: "respawning" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", deadGhost], ["g2", respawning]]),
      powerPellets: new Set(["2,2"]),
    });

    const result = checkPelletCollisions(state, DEFAULTS);
    expect(result.players.get("g1")!.status).toBe("dead");
    expect(result.players.get("g2")!.status).toBe("respawning");
  });

  it("does nothing when pacman is not on a pellet", () => {
    const pacman = makePlayer({ id: "p1", position: { x: 1, y: 1 }, role: "pacman" });
    const ghost = makePlayer({ id: "g1", position: { x: 3, y: 3 }, role: "ghost" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      powerPellets: new Set(["2,2"]),
    });

    const result = checkPelletCollisions(state, DEFAULTS);
    expect(result.powerPellets.has("2,2")).toBe(true);
    expect(result.players.get("g1")!.status).toBe("active");
    expect(result.vulnerabilityTimer).toBe(0);
  });

  it("ghost does not consume power pellets", () => {
    const ghost = makePlayer({ id: "g1", position: { x: 2, y: 2 }, role: "ghost" });
    const state = makeGameState({
      players: new Map([["g1", ghost]]),
      powerPellets: new Set(["2,2"]),
    });

    const result = checkPelletCollisions(state, DEFAULTS);
    expect(result.powerPellets.has("2,2")).toBe(true);
  });
});

describe("updateTimers", () => {
  it("decrements vulnerability timer", () => {
    const state = makeGameState({ vulnerabilityTimer: 50 });
    const result = updateTimers(state);
    expect(result.vulnerabilityTimer).toBe(49);
  });

  it("does nothing when timer is already 0", () => {
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active" });
    const state = makeGameState({
      vulnerabilityTimer: 0,
      players: new Map([["g1", ghost]]),
    });

    const result = updateTimers(state);
    expect(result.vulnerabilityTimer).toBe(0);
    expect(result.players.get("g1")!.status).toBe("active");
  });

  it("reverts vulnerable ghosts to active when timer hits 0", () => {
    const ghost1 = makePlayer({ id: "g1", role: "ghost", status: "vulnerable" });
    const ghost2 = makePlayer({ id: "g2", role: "ghost", status: "vulnerable" });
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "active" });
    const state = makeGameState({
      vulnerabilityTimer: 1,
      players: new Map([["g1", ghost1], ["g2", ghost2], ["p1", pacman]]),
    });

    const result = updateTimers(state);
    expect(result.vulnerabilityTimer).toBe(0);
    expect(result.players.get("g1")!.status).toBe("active");
    expect(result.players.get("g2")!.status).toBe("active");
    expect(result.players.get("p1")!.status).toBe("active");
  });

  it("does not revert respawning ghosts when timer expires", () => {
    const respawning = makePlayer({ id: "g1", role: "ghost", status: "respawning" });
    const vulnerable = makePlayer({ id: "g2", role: "ghost", status: "vulnerable" });
    const state = makeGameState({
      vulnerabilityTimer: 1,
      players: new Map([["g1", respawning], ["g2", vulnerable]]),
    });

    const result = updateTimers(state);
    expect(result.players.get("g1")!.status).toBe("respawning");
    expect(result.players.get("g2")!.status).toBe("active");
  });

  it("keeps vulnerable ghosts while timer is still active", () => {
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "vulnerable" });
    const state = makeGameState({
      vulnerabilityTimer: 10,
      players: new Map([["g1", ghost]]),
    });

    const result = updateTimers(state);
    expect(result.vulnerabilityTimer).toBe(9);
    expect(result.players.get("g1")!.status).toBe("vulnerable");
  });

  it("decrements respawn timers", () => {
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "respawning", position: { x: 1, y: 1 } });
    const state = makeGameState({
      players: new Map([["g1", ghost]]),
      respawnTimers: new Map([["g1", 30]]),
    });

    const result = updateTimers(state);
    expect(result.respawnTimers.get("g1")).toBe(29);
    expect(result.players.get("g1")!.status).toBe("respawning");
  });

  it("respawns ghost at ghost spawn when respawn timer expires", () => {
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "respawning", position: { x: 2, y: 2 } });
    const state = makeGameState({
      players: new Map([["g1", ghost]]),
      respawnTimers: new Map([["g1", 1]]),
    });

    const result = updateTimers(state);
    expect(result.respawnTimers.has("g1")).toBe(false);
    expect(result.players.get("g1")!.status).toBe("active");
    // Ghost spawn is at (1, 3) in the TEST_MAP
    expect(result.players.get("g1")!.position).toEqual({ x: 1, y: 3 });
    expect(result.players.get("g1")!.direction).toBeNull();
  });
});

describe("checkPlayerCollisions", () => {
  it("pacman dies when hitting an active ghost", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "active", position: { x: 2, y: 2 } });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active", position: { x: 2, y: 2 } });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      scores: new Map([["p1", 5], ["g1", 0]]),
    });

    const result = checkPlayerCollisions(state, DEFAULTS);
    expect(result.players.get("p1")!.status).toBe("dead");
    expect(result.players.get("g1")!.status).toBe("active");
  });

  it("pacman stops moving after death (status is dead)", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "active", position: { x: 2, y: 2 }, direction: "right" });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active", position: { x: 2, y: 2 } });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      scores: new Map([["p1", 0], ["g1", 0]]),
    });

    const result = checkPlayerCollisions(state, DEFAULTS);
    expect(result.players.get("p1")!.status).toBe("dead");
  });

  it("pacman eats vulnerable ghost - ghost becomes respawning, pacman score incremented", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "active", position: { x: 3, y: 1 } });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "vulnerable", position: { x: 3, y: 1 } });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      scores: new Map([["p1", 2], ["g1", 0]]),
      vulnerabilityTimer: 50,
    });

    const result = checkPlayerCollisions(state, DEFAULTS);
    expect(result.players.get("g1")!.status).toBe("respawning");
    expect(result.scores.get("p1")).toBe(3);
    expect(result.respawnTimers.get("g1")).toBe(DEFAULTS.ghostRespawnDelay);
  });

  it("no collision when players are at different positions", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "active", position: { x: 1, y: 1 } });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active", position: { x: 3, y: 3 } });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      scores: new Map([["p1", 0], ["g1", 0]]),
    });

    const result = checkPlayerCollisions(state, DEFAULTS);
    expect(result.players.get("p1")!.status).toBe("active");
    expect(result.players.get("g1")!.status).toBe("active");
  });

  it("dead pacman does not interact with ghosts", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "dead", position: { x: 2, y: 2 } });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active", position: { x: 2, y: 2 } });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
    });

    const result = checkPlayerCollisions(state, DEFAULTS);
    expect(result.players.get("p1")!.status).toBe("dead");
    expect(result.players.get("g1")!.status).toBe("active");
  });

  it("respawning ghost does not interact with pacman", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "active", position: { x: 2, y: 2 } });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "respawning", position: { x: 2, y: 2 } });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
    });

    const result = checkPlayerCollisions(state, DEFAULTS);
    expect(result.players.get("p1")!.status).toBe("active");
    expect(result.players.get("g1")!.status).toBe("respawning");
  });

  it("two pacmans hitting same vulnerable ghost - first pacman gets the kill", () => {
    const p1 = makePlayer({ id: "p1", role: "pacman", status: "active", position: { x: 2, y: 2 } });
    const p2 = makePlayer({ id: "p2", role: "pacman", status: "active", position: { x: 2, y: 2 } });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "vulnerable", position: { x: 2, y: 2 } });
    const state = makeGameState({
      players: new Map([["p1", p1], ["p2", p2], ["g1", ghost]]),
      scores: new Map([["p1", 0], ["p2", 0], ["g1", 0]]),
      vulnerabilityTimer: 50,
    });

    const result = checkPlayerCollisions(state, DEFAULTS);
    expect(result.players.get("g1")!.status).toBe("respawning");
    // Only one pacman should get the score
    const p1Score = result.scores.get("p1")!;
    const p2Score = result.scores.get("p2")!;
    expect(p1Score + p2Score).toBe(1);
  });
});

describe("config integration", () => {
  const customConfig = { ...DEFAULTS, powerPelletDuration: 50, ghostRespawnDelay: 10 };

  it("checkPelletCollisions uses config powerPelletDuration", () => {
    const pacman = makePlayer({ id: "p1", position: { x: 2, y: 2 }, role: "pacman" });
    const ghost = makePlayer({ id: "g1", position: { x: 3, y: 3 }, role: "ghost", status: "active" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      powerPellets: new Set(["2,2"]),
    });

    const result = checkPelletCollisions(state, customConfig);
    expect(result.vulnerabilityTimer).toBe(50);
  });

  it("checkPlayerCollisions uses config ghostRespawnDelay", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "active", position: { x: 3, y: 1 } });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "vulnerable", position: { x: 3, y: 1 } });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      scores: new Map([["p1", 0], ["g1", 0]]),
      vulnerabilityTimer: 50,
    });

    const result = checkPlayerCollisions(state, customConfig);
    expect(result.respawnTimers.get("g1")).toBe(10);
  });
});
