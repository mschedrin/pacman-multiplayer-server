import type { GameRoom } from "./game-room";

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  ADMIN_API_KEY: string;
}

export type CellType =
  | "wall"
  | "empty"
  | "dot"
  | "power_pellet"
  | "pacman_spawn"
  | "ghost_spawn";

export interface GameMap {
  width: number;
  height: number;
  cells: CellType[][];
}

export type Role = "pacman" | "ghost";

export type Direction = "up" | "down" | "left" | "right";

export type PlayerStatus = "lobby" | "active" | "vulnerable" | "dead" | "respawning";

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  role: Role | null;
  position: { x: number; y: number } | null;
  direction: Direction | null;
}

export type RoundState = "stopped" | "lobby" | "playing";

export interface GameState {
  map: GameMap;
  players: Map<string, Player>;
  dots: Set<string>; // "x,y" keys for O(1) lookup
  powerPellets: Set<string>; // "x,y" keys
  scores: Map<string, number>;
  vulnerabilityTimer: number; // ticks remaining, 0 = inactive
  respawnTimers: Map<string, number>; // playerId → ticks remaining
  tick: number; // current tick count
}

export interface GameConfig {
  tickRate: number;
  powerPelletDuration: number;
  ghostRespawnDelay: number;
  pacmanCount: number;
  maxPlayers: number;
  idleShutdownMinutes: number;
}

export const DEFAULTS: GameConfig = {
  tickRate: 3,
  powerPelletDuration: 100,
  ghostRespawnDelay: 60,
  pacmanCount: 1,
  maxPlayers: 10,
  idleShutdownMinutes: 180,
};

// Client → Server messages
export interface JoinMessage {
  type: "join";
  name: string;
}

export interface InputMessage {
  type: "input";
  direction: Direction;
}

// Server → Client messages
export interface WelcomeMessage {
  type: "welcome";
  id: string;
  name: string;
  players: Player[];
}

export interface LobbyMessage {
  type: "lobby";
  players: Player[];
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface RoundStartMessage {
  type: "round_start";
  map: { width: number; height: number; cells: CellType[][] };
  role: Role;
  players: {
    id: string;
    name: string;
    role: Role;
    position: { x: number; y: number };
  }[];
  config: GameConfig;
}

export interface StateMessage {
  type: "state";
  tick: number;
  players: {
    id: string;
    name: string;
    role: Role;
    position: { x: number; y: number };
    status: PlayerStatus;
    score: number;
  }[];
  dots: [number, number][];
  powerPellets: [number, number][];
  timeElapsed: number;
}

export interface RoundEndMessage {
  type: "round_end";
  result: "pacman" | "ghosts" | "cancelled";
  scores: Record<string, number>;
}

export type ClientMessage = JoinMessage | InputMessage;
export type ServerMessage =
  | WelcomeMessage
  | LobbyMessage
  | ErrorMessage
  | RoundStartMessage
  | StateMessage
  | RoundEndMessage;
