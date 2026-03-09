import { DurableObject } from "cloudflare:workers";
import type {
  Env,
  Player,
  ServerMessage,
  RoundState,
  GameState,
  GameConfig,
  RoundStartMessage,
  StateMessage,
  RoundEndMessage,
  Role,
} from "./types";
import { DEFAULTS } from "./types";
import { parseCharGrid, DEFAULT_MAP, validateMap } from "./map";
import { assignRoles } from "./roles";
import { tick, checkRoundEnd } from "./game-loop";

const MAX_PLAYERS = 10;
const MAX_NAME_LENGTH = 30;

export class GameRoom extends DurableObject<Env> {
  private roundState: RoundState = "lobby";
  private gameState: GameState | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  async fetch(request: Request): Promise<Response> {
    // Reject new connections during active round
    if (this.roundState === "playing") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(
        JSON.stringify({
          type: "error",
          message: "Round in progress",
        })
      );
      server.close(1008, "Round in progress");
      return new Response(null, { status: 101, webSocket: client });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private getPlayerRoster(): Player[] {
    return this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment() as Player | null)
      .filter((p): p is Player => p !== null && p.id !== undefined);
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      const player = ws.deserializeAttachment() as Player | null;
      if (player && player.id) {
        try {
          ws.send(payload);
        } catch {
          // Socket may have dropped; close/error handler will clean up
        }
      }
    }
  }

  startRound(): { success: boolean; error?: string } {
    const roster = this.getPlayerRoster();

    if (roster.length < 2) {
      return { success: false, error: "Need at least 2 players to start" };
    }

    if (this.roundState === "playing") {
      return { success: false, error: "Round already in progress" };
    }

    // Parse and validate map
    const map = parseCharGrid(DEFAULT_MAP);
    const validation = validateMap(map);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid map: ${validation.errors.join(", ")}`,
      };
    }

    // Assign roles
    const playerIds = roster.map((p) => p.id);
    const roles = assignRoles(playerIds, 1); // 1 pacman by default

    // Find spawn positions
    const pacmanSpawns: { x: number; y: number }[] = [];
    const ghostSpawns: { x: number; y: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.cells[y].length; x++) {
        if (map.cells[y][x] === "pacman_spawn") {
          pacmanSpawns.push({ x, y });
        } else if (map.cells[y][x] === "ghost_spawn") {
          ghostSpawns.push({ x, y });
        }
      }
    }

    // Initialize game state
    const players = new Map<string, Player>();
    const scores = new Map<string, number>();
    const dots = new Set<string>();
    const powerPellets = new Set<string>();

    // Collect dots and power pellets from the map
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.cells[y].length; x++) {
        if (map.cells[y][x] === "dot") {
          dots.add(`${x},${y}`);
        } else if (map.cells[y][x] === "power_pellet") {
          powerPellets.add(`${x},${y}`);
        }
      }
    }

    // Place players at spawn points
    let pacmanSpawnIdx = 0;
    let ghostSpawnIdx = 0;

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Player | null;
      if (!attachment || !attachment.id) continue;

      const role = roles.get(attachment.id)!;
      let position: { x: number; y: number };

      if (role === "pacman") {
        position =
          pacmanSpawns[pacmanSpawnIdx % pacmanSpawns.length];
        pacmanSpawnIdx++;
      } else {
        position =
          ghostSpawns[ghostSpawnIdx % ghostSpawns.length];
        ghostSpawnIdx++;
      }

      const updatedPlayer: Player = {
        ...attachment,
        role,
        position: { ...position },
        direction: null,
        status: "active",
      };

      players.set(attachment.id, updatedPlayer);
      scores.set(attachment.id, 0);

      // Update WebSocket attachment
      ws.serializeAttachment(updatedPlayer);
    }

    this.gameState = {
      map,
      players,
      dots,
      powerPellets,
      scores,
      vulnerabilityTimer: 0,
      respawnTimers: new Map(),
      tick: 0,
    };

    this.roundState = "playing";

    // Build player info for round_start message
    const playerInfos = Array.from(players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role as Role,
      position: p.position as { x: number; y: number },
    }));

    const config: GameConfig = { ...DEFAULTS };

    // Send round_start to each client with their specific role
    for (const ws of this.ctx.getWebSockets()) {
      const player = ws.deserializeAttachment() as Player | null;
      if (!player || !player.id) continue;

      const roundStartMsg: RoundStartMessage = {
        type: "round_start",
        map: { width: map.width, height: map.height, cells: map.cells },
        role: players.get(player.id)!.role as Role,
        players: playerInfos,
        config,
      };

      try {
        ws.send(JSON.stringify(roundStartMsg));
      } catch {
        // Socket may have dropped
      }
    }

    // Start the game loop
    this.startGameLoop();

    return { success: true };
  }

  private startGameLoop(): void {
    const intervalMs = 1000 / DEFAULTS.tickRate;
    this.tickInterval = setInterval(() => {
      this.runTick();
    }, intervalMs);
  }

  stopGameLoop(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private runTick(): void {
    if (!this.gameState) return;

    this.gameState = tick(this.gameState);

    const endCheck = checkRoundEnd(this.gameState);
    if (endCheck.ended) {
      this.endRound(endCheck.result!);
    } else {
      this.broadcastState();
    }
  }

  private endRound(result: "pacman" | "ghosts"): void {
    this.stopGameLoop();

    // Build final scores
    const scores: Record<string, number> = {};
    if (this.gameState) {
      for (const [id, score] of this.gameState.scores) {
        scores[id] = score;
      }
    }

    // Broadcast round_end
    const roundEndMsg: RoundEndMessage = {
      type: "round_end",
      result,
      scores,
    };
    this.broadcast(roundEndMsg);

    // Reset to lobby
    this.roundState = "lobby";
    this.gameState = null;

    // Reset all player statuses to lobby
    for (const ws of this.ctx.getWebSockets()) {
      const player = ws.deserializeAttachment() as Player | null;
      if (player && player.id) {
        const lobbyPlayer: Player = {
          ...player,
          status: "lobby",
          role: null,
          position: null,
          direction: null,
        };
        ws.serializeAttachment(lobbyPlayer);
      }
    }

    // Broadcast lobby update
    this.broadcast({ type: "lobby", players: this.getPlayerRoster() });
  }

  private broadcastState(): void {
    if (!this.gameState) return;

    const state = this.gameState;
    const players = Array.from(state.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role as Role,
      position: p.position as { x: number; y: number },
      status: p.status,
      score: state.scores.get(p.id) ?? 0,
    }));

    const dots: [number, number][] = Array.from(state.dots).map((key) => {
      const [x, y] = key.split(",").map(Number);
      return [x, y];
    });

    const powerPellets: [number, number][] = Array.from(
      state.powerPellets
    ).map((key) => {
      const [x, y] = key.split(",").map(Number);
      return [x, y];
    });

    const msg: StateMessage = {
      type: "state",
      tick: state.tick,
      players,
      dots,
      powerPellets,
      timeElapsed: state.tick / DEFAULTS.tickRate,
    };

    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const player = ws.deserializeAttachment() as Player | null;
      if (player && player.id) {
        try {
          ws.send(payload);
        } catch {
          // Socket may have dropped
        }
      }
    }
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (typeof message !== "string") {
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid message format" })
      );
      return;
    }

    let data: { type?: string; [key: string]: unknown };
    try {
      data = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid message format" })
      );
      return;
    }

    if (data.type === "join") {
      // Reject joins during active round
      if (this.roundState === "playing") {
        ws.send(
          JSON.stringify({ type: "error", message: "Round in progress" })
        );
        return;
      }

      // Check if already joined
      const existing = ws.deserializeAttachment() as Player | null;
      if (existing && existing.id) {
        ws.send(JSON.stringify({ type: "error", message: "Already joined" }));
        return;
      }

      // Validate name
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (!name) {
        ws.send(
          JSON.stringify({ type: "error", message: "Name is required" })
        );
        return;
      }
      if (name.length > MAX_NAME_LENGTH) {
        ws.send(JSON.stringify({ type: "error", message: "Name too long" }));
        return;
      }

      // Check player cap
      const currentRoster = this.getPlayerRoster();
      if (currentRoster.length >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: "error", message: "Server is full" }));
        ws.close(1008, "Server is full");
        return;
      }

      // Create player
      const id = crypto.randomUUID();
      const player: Player = {
        id,
        name,
        status: "lobby",
        role: null,
        position: null,
        direction: null,
      };
      ws.serializeAttachment(player);

      // Send welcome (reuse roster + new player to avoid extra getWebSockets scan)
      const players = [...currentRoster, player];
      ws.send(JSON.stringify({ type: "welcome", id, name, players }));

      // Broadcast lobby update to all clients
      this.broadcast({ type: "lobby", players });
      return;
    }

    // Non-join message: check if player has joined first
    const existing = ws.deserializeAttachment() as Player | null;
    if (!existing || !existing.id) {
      ws.send(
        JSON.stringify({ type: "error", message: "Must join first" })
      );
      return;
    }

    if (data.type === "input") {
      // Ignore input when round is not active
      if (this.roundState !== "playing") {
        return;
      }

      // Validate direction value
      const validDirections = ["up", "down", "left", "right"];
      if (!validDirections.includes(data.direction as string)) {
        ws.send(
          JSON.stringify({ type: "error", message: "Invalid direction" })
        );
        return;
      }

      // Ignore input from dead players
      const playerState = this.gameState?.players.get(existing.id);
      if (playerState && playerState.status === "dead") {
        return;
      }

      // Store latest direction on game state player
      if (this.gameState && playerState) {
        playerState.direction = data.direction as Player["direction"];
        this.gameState.players.set(existing.id, playerState);
      }
      return;
    }

    // Unknown message type
    ws.send(
      JSON.stringify({ type: "error", message: "Unknown message type" })
    );
    return;
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    this.cleanupPlayer(ws, code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    this.cleanupPlayer(ws, 1011, "WebSocket error");
  }

  private cleanupPlayer(ws: WebSocket, code: number, reason: string): void {
    const player = ws.deserializeAttachment() as Player | null;
    ws.serializeAttachment(null);
    try {
      ws.close(code, reason);
    } catch {
      // WebSocket may already be closed or code may be invalid (e.g. 1005)
    }
    if (player && player.id) {
      // Handle disconnect during active round
      if (this.roundState === "playing" && this.gameState) {
        const gamePlayer = this.gameState.players.get(player.id);
        if (gamePlayer && gamePlayer.role === "pacman" && gamePlayer.status !== "dead") {
          // Mark disconnected pacman as dead
          this.gameState.players.set(player.id, { ...gamePlayer, status: "dead" });

          // Check if all pacmans are now dead
          const endCheck = checkRoundEnd(this.gameState);
          if (endCheck.ended) {
            this.endRound(endCheck.result!);
            return;
          }
        }
        // Remove disconnected player from game state
        this.gameState.players.delete(player.id);
        this.gameState.scores.delete(player.id);
        this.gameState.respawnTimers.delete(player.id);
      }

      // Only broadcast lobby update when not in an active round
      if (this.roundState === "lobby") {
        this.broadcast({ type: "lobby", players: this.getPlayerRoster() });
      }
    }
  }
}
