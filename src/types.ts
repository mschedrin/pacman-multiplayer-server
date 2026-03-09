import type { GameRoom } from "./game-room";

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
}

export interface Player {
  id: string;
  name: string;
  status: "lobby";
}

// Client → Server messages
export interface JoinMessage {
  type: "join";
  name: string;
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

export type ClientMessage = JoinMessage;
export type ServerMessage = WelcomeMessage | LobbyMessage | ErrorMessage;
