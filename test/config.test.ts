import { describe, it, expect } from "vitest";
import { mergeConfig } from "../src/config";
import { DEFAULTS } from "../src/types";
import type { GameConfig } from "../src/types";

describe("DEFAULTS", () => {
  it("has all expected keys with correct default values", () => {
    expect(DEFAULTS.tickRate).toBe(3);
    expect(DEFAULTS.powerPelletDuration).toBe(100);
    expect(DEFAULTS.ghostRespawnDelay).toBe(60);
    expect(DEFAULTS.pacmanCount).toBe(1);
    expect(DEFAULTS.maxPlayers).toBe(10);
    expect(DEFAULTS.idleShutdownMinutes).toBe(180);
  });

  it("has exactly the expected keys", () => {
    const keys = Object.keys(DEFAULTS).sort();
    expect(keys).toEqual([
      "ghostRespawnDelay",
      "idleShutdownMinutes",
      "maxPlayers",
      "pacmanCount",
      "powerPelletDuration",
      "tickRate",
    ]);
  });
});

describe("mergeConfig", () => {
  it("returns defaults when overrides are empty", () => {
    const result = mergeConfig(DEFAULTS, {});
    expect(result).toEqual(DEFAULTS);
  });

  it("applies partial overrides", () => {
    const result = mergeConfig(DEFAULTS, { tickRate: 30 });
    expect(result.tickRate).toBe(30);
    expect(result.powerPelletDuration).toBe(DEFAULTS.powerPelletDuration);
    expect(result.ghostRespawnDelay).toBe(DEFAULTS.ghostRespawnDelay);
    expect(result.pacmanCount).toBe(DEFAULTS.pacmanCount);
    expect(result.maxPlayers).toBe(DEFAULTS.maxPlayers);
    expect(result.idleShutdownMinutes).toBe(DEFAULTS.idleShutdownMinutes);
  });

  it("applies multiple overrides", () => {
    const result = mergeConfig(DEFAULTS, {
      tickRate: 10,
      pacmanCount: 2,
      maxPlayers: 20,
    });
    expect(result.tickRate).toBe(10);
    expect(result.pacmanCount).toBe(2);
    expect(result.maxPlayers).toBe(20);
    expect(result.powerPelletDuration).toBe(DEFAULTS.powerPelletDuration);
  });

  it("applies all overrides at once", () => {
    const full: GameConfig = {
      tickRate: 10,
      powerPelletDuration: 50,
      ghostRespawnDelay: 30,
      pacmanCount: 3,
      maxPlayers: 5,
      idleShutdownMinutes: 60,
    };
    const result = mergeConfig(DEFAULTS, full);
    expect(result).toEqual(full);
  });

  it("rejects zero values", () => {
    expect(() => mergeConfig(DEFAULTS, { tickRate: 0 })).toThrow(
      "Invalid value for tickRate"
    );
  });

  it("rejects negative values", () => {
    expect(() => mergeConfig(DEFAULTS, { maxPlayers: -5 })).toThrow(
      "Invalid value for maxPlayers"
    );
  });

  it("rejects NaN values", () => {
    expect(() => mergeConfig(DEFAULTS, { tickRate: NaN })).toThrow(
      "Invalid value for tickRate"
    );
  });

  it("rejects Infinity values", () => {
    expect(() => mergeConfig(DEFAULTS, { tickRate: Infinity })).toThrow(
      "Invalid value for tickRate"
    );
  });

  it("rejects unknown keys", () => {
    const overrides = { tickRate: 10, unknownKey: 42 } as Partial<GameConfig>;
    expect(() => mergeConfig(DEFAULTS, overrides)).toThrow("Unknown config key: unknownKey");
  });

  it("reports multiple errors at once", () => {
    const overrides = { tickRate: -1, maxPlayers: 0 } as Partial<GameConfig>;
    expect(() => mergeConfig(DEFAULTS, overrides)).toThrow("Invalid value for tickRate");
    expect(() => mergeConfig(DEFAULTS, overrides)).toThrow("Invalid value for maxPlayers");
  });

  it("does not modify the defaults object", () => {
    const original = { ...DEFAULTS };
    mergeConfig(DEFAULTS, { tickRate: 999 });
    expect(DEFAULTS).toEqual(original);
  });
});
