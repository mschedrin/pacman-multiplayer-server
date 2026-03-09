import type { GameConfig } from "./types";
import { DEFAULTS } from "./types";

/**
 * Validate a single config value: must be a positive finite number.
 */
function isValidValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Config keys that must be integers. */
const INTEGER_KEYS: ReadonlySet<string> = new Set([
  "tickRate",
  "powerPelletDuration",
  "ghostRespawnDelay",
  "pacmanCount",
  "maxPlayers",
]);

/** All valid keys in GameConfig. */
const VALID_KEYS: ReadonlySet<string> = new Set<string>(Object.keys(DEFAULTS));

/**
 * Merge runtime overrides onto defaults with validation.
 * Throws on invalid values (non-positive numbers, unknown keys, non-integer where required).
 */
export function mergeConfig(
  defaults: GameConfig,
  overrides: Partial<GameConfig>
): GameConfig {
  const errors: string[] = [];

  for (const key of Object.keys(overrides)) {
    if (!VALID_KEYS.has(key)) {
      errors.push(`Unknown config key: ${key}`);
      continue;
    }

    const value = overrides[key as keyof GameConfig];
    if (value === undefined) continue;

    if (!isValidValue(value)) {
      errors.push(`Invalid value for ${key}: must be a positive number`);
    } else if (INTEGER_KEYS.has(key) && !Number.isInteger(value)) {
      errors.push(`Invalid value for ${key}: must be an integer`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return { ...defaults, ...overrides };
}

/**
 * Filter overrides to only keep valid fields, discarding any that fail validation.
 * Unlike mergeConfig, this never throws — invalid fields are silently dropped.
 * Returns the sanitized overrides (not merged with defaults).
 */
export function sanitizeOverrides(
  overrides: Partial<GameConfig>
): Partial<GameConfig> {
  const sanitized: Partial<GameConfig> = {};

  for (const key of Object.keys(overrides)) {
    if (!VALID_KEYS.has(key)) continue;

    const value = overrides[key as keyof GameConfig];
    if (value === undefined) continue;

    if (!isValidValue(value)) continue;
    if (INTEGER_KEYS.has(key) && !Number.isInteger(value)) continue;

    (sanitized as Record<string, unknown>)[key] = value;
  }

  return sanitized;
}
