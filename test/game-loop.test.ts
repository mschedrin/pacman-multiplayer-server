import { describe, it, expect } from "vitest";
import { processMovement, tick, checkRoundEnd } from "../src/game-loop";
import type { GameState, Player, GameMap } from "../src/types";
import { DEFAULTS } from "../src/types";

// A simple 5x5 map for testing:
// #####
// #P .#
// # # #
// #G. #
// #####
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

describe("processMovement", () => {
  it("moves player in their direction", () => {
    const player = makePlayer({ id: "p1", position: { x: 1, y: 1 }, direction: "right" });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    const moved = result.players.get("p1")!;
    expect(moved.position).toEqual({ x: 2, y: 1 });
  });

  it("moves player up", () => {
    const player = makePlayer({ id: "p1", position: { x: 1, y: 2 }, direction: "up" });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 1 });
  });

  it("moves player down", () => {
    const player = makePlayer({ id: "p1", position: { x: 1, y: 1 }, direction: "down" });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 2 });
  });

  it("moves player left", () => {
    const player = makePlayer({ id: "p1", position: { x: 2, y: 1 }, direction: "left" });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 1 });
  });

  it("wall blocks movement — player stays in place", () => {
    // Position (1,1), direction up → target (1,0) which is wall
    const player = makePlayer({ id: "p1", position: { x: 1, y: 1 }, direction: "up" });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 1 });
  });

  it("wall in the middle of the map blocks movement", () => {
    // Position (1,2), direction right → target (2,2) which is wall
    const player = makePlayer({ id: "p1", position: { x: 1, y: 2 }, direction: "right" });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 2 });
  });

  it("no direction — player stays stationary", () => {
    const player = makePlayer({ id: "p1", position: { x: 1, y: 1 }, direction: null });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 1 });
  });

  it("dead players don't move", () => {
    const player = makePlayer({
      id: "p1",
      position: { x: 1, y: 1 },
      direction: "right",
      status: "dead",
    });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 1 });
  });

  it("respawning players don't move", () => {
    const player = makePlayer({
      id: "p1",
      position: { x: 1, y: 1 },
      direction: "right",
      status: "respawning",
    });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 1 });
  });

  it("lobby players don't move", () => {
    const player = makePlayer({
      id: "p1",
      position: { x: 1, y: 1 },
      direction: "right",
      status: "lobby",
    });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 1 });
  });

  it("vulnerable players can move", () => {
    const player = makePlayer({
      id: "p1",
      position: { x: 1, y: 1 },
      direction: "right",
      status: "vulnerable",
      role: "ghost",
    });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 2, y: 1 });
  });

  it("multiple players move independently", () => {
    const p1 = makePlayer({ id: "p1", position: { x: 1, y: 1 }, direction: "right" });
    const p2 = makePlayer({
      id: "p2",
      position: { x: 3, y: 3 },
      direction: "left",
      role: "ghost",
    });
    const state = makeGameState({
      players: new Map([
        ["p1", p1],
        ["p2", p2],
      ]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 2, y: 1 });
    expect(result.players.get("p2")!.position).toEqual({ x: 2, y: 3 });
  });

  it("movement to map boundary (wall) is blocked", () => {
    // Position (3,1), direction right → target (4,1) which is wall (boundary)
    const player = makePlayer({ id: "p1", position: { x: 3, y: 1 }, direction: "right" });
    const state = makeGameState({
      players: new Map([["p1", player]]),
    });

    const result = processMovement(state);
    expect(result.players.get("p1")!.position).toEqual({ x: 3, y: 1 });
  });
});

describe("tick", () => {
  it("increments tick counter", () => {
    const state = makeGameState({ tick: 0 });
    const result = tick(state, DEFAULTS);
    expect(result.tick).toBe(1);
  });

  it("increments tick counter from non-zero", () => {
    const state = makeGameState({ tick: 42 });
    const result = tick(state, DEFAULTS);
    expect(result.tick).toBe(43);
  });

  it("applies movement during tick", () => {
    const player = makePlayer({ id: "p1", position: { x: 1, y: 1 }, direction: "right" });
    const state = makeGameState({
      players: new Map([["p1", player]]),
      tick: 0,
    });

    const result = tick(state, DEFAULTS);
    expect(result.tick).toBe(1);
    expect(result.players.get("p1")!.position).toEqual({ x: 2, y: 1 });
  });

  it("does not mutate original state", () => {
    const player = makePlayer({ id: "p1", position: { x: 1, y: 1 }, direction: "right" });
    const state = makeGameState({
      players: new Map([["p1", player]]),
      tick: 0,
    });

    const result = tick(state, DEFAULTS);
    // Original unchanged
    expect(state.tick).toBe(0);
    expect(state.players.get("p1")!.position).toEqual({ x: 1, y: 1 });
    // New state updated
    expect(result.tick).toBe(1);
    expect(result.players.get("p1")!.position).toEqual({ x: 2, y: 1 });
  });

  it("handles empty player list", () => {
    const state = makeGameState({ tick: 5 });
    const result = tick(state, DEFAULTS);
    expect(result.tick).toBe(6);
    expect(result.players.size).toBe(0);
  });

  it("orchestrates movement for multiple players in one tick", () => {
    const p1 = makePlayer({ id: "p1", position: { x: 1, y: 1 }, direction: "down" });
    const p2 = makePlayer({
      id: "p2",
      position: { x: 3, y: 3 },
      direction: "up",
      role: "ghost",
    });
    const dead = makePlayer({
      id: "p3",
      position: { x: 1, y: 3 },
      direction: "right",
      status: "dead",
    });
    const state = makeGameState({
      players: new Map([
        ["p1", p1],
        ["p2", p2],
        ["p3", dead],
      ]),
      tick: 10,
    });

    const result = tick(state, DEFAULTS);
    expect(result.tick).toBe(11);
    expect(result.players.get("p1")!.position).toEqual({ x: 1, y: 2 });
    expect(result.players.get("p2")!.position).toEqual({ x: 3, y: 2 });
    expect(result.players.get("p3")!.position).toEqual({ x: 1, y: 3 }); // dead, no move
  });
});

describe("checkRoundEnd", () => {
  it("returns pacman win when all dots are eaten", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "active" });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      dots: new Set(), // no dots remaining
    });

    const result = checkRoundEnd(state);
    expect(result.ended).toBe(true);
    expect(result.result).toBe("pacman");
  });

  it("returns ghosts win when all pacmans are dead", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "dead" });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      dots: new Set(["1,1"]),
    });

    const result = checkRoundEnd(state);
    expect(result.ended).toBe(true);
    expect(result.result).toBe("ghosts");
  });

  it("returns not ended when dots remain and pacman is alive", () => {
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "active" });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      dots: new Set(["1,1"]),
    });

    const result = checkRoundEnd(state);
    expect(result.ended).toBe(false);
    expect(result.result).toBeUndefined();
  });

  it("returns ghosts win when multiple pacmans are all dead", () => {
    const p1 = makePlayer({ id: "p1", role: "pacman", status: "dead" });
    const p2 = makePlayer({ id: "p2", role: "pacman", status: "dead" });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active" });
    const state = makeGameState({
      players: new Map([["p1", p1], ["p2", p2], ["g1", ghost]]),
      dots: new Set(["1,1"]),
    });

    const result = checkRoundEnd(state);
    expect(result.ended).toBe(true);
    expect(result.result).toBe("ghosts");
  });

  it("returns not ended when one pacman is alive and another is dead", () => {
    const p1 = makePlayer({ id: "p1", role: "pacman", status: "dead" });
    const p2 = makePlayer({ id: "p2", role: "pacman", status: "active" });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active" });
    const state = makeGameState({
      players: new Map([["p1", p1], ["p2", p2], ["g1", ghost]]),
      dots: new Set(["1,1"]),
    });

    const result = checkRoundEnd(state);
    expect(result.ended).toBe(false);
  });

  it("pacman win takes priority when dots empty and pacmans dead simultaneously", () => {
    // Edge case: dots consumed same tick pacman dies.
    // Dots check comes first, so pacman wins.
    const pacman = makePlayer({ id: "p1", role: "pacman", status: "dead" });
    const ghost = makePlayer({ id: "g1", role: "ghost", status: "active" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      dots: new Set(), // no dots
    });

    const result = checkRoundEnd(state);
    expect(result.ended).toBe(true);
    expect(result.result).toBe("pacman");
  });
});

describe("tick with custom config", () => {
  it("uses custom powerPelletDuration when pacman eats pellet", () => {
    const customConfig = { ...DEFAULTS, powerPelletDuration: 25 };
    const pacman = makePlayer({ id: "p1", position: { x: 2, y: 1 }, direction: "right", role: "pacman" });
    const ghost = makePlayer({ id: "g1", position: { x: 3, y: 3 }, role: "ghost", status: "active" });
    // Place a power pellet at (3,1) where pacman will move to
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      powerPellets: new Set(["3,1"]),
      tick: 0,
    });

    const result = tick(state, customConfig);
    // Pacman moves to (3,1) where power pellet is
    expect(result.players.get("p1")!.position).toEqual({ x: 3, y: 1 });
    expect(result.powerPellets.has("3,1")).toBe(false);
    // Timer set to 25 then decremented by 1 in updateTimers within same tick
    expect(result.vulnerabilityTimer).toBe(24);
    expect(result.players.get("g1")!.status).toBe("vulnerable");
  });

  it("uses custom ghostRespawnDelay when pacman eats ghost", () => {
    const customConfig = { ...DEFAULTS, ghostRespawnDelay: 15 };
    const pacman = makePlayer({ id: "p1", position: { x: 2, y: 1 }, direction: null, role: "pacman" });
    const ghost = makePlayer({ id: "g1", position: { x: 2, y: 1 }, role: "ghost", status: "vulnerable" });
    const state = makeGameState({
      players: new Map([["p1", pacman], ["g1", ghost]]),
      scores: new Map([["p1", 0], ["g1", 0]]),
      vulnerabilityTimer: 50,
      tick: 0,
    });

    const result = tick(state, customConfig);
    expect(result.players.get("g1")!.status).toBe("respawning");
    // Timer set to 15 then decremented by 1 in updateTimers within same tick
    expect(result.respawnTimers.get("g1")).toBe(14);
  });
});
