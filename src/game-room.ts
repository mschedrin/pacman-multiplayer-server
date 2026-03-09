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
import { mergeConfig, sanitizeOverrides } from "./config";
import { parseCharGrid, DEFAULT_MAP, validateMap } from "./map";
import { assignRoles } from "./roles";
import { tick, checkRoundEnd } from "./game-loop";

const MAX_NAME_LENGTH = 30;

export class GameRoom extends DurableObject<Env> {
  private roundState: RoundState = "stopped";
  private gameState: GameState | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private activeConfig: GameConfig = { ...DEFAULTS };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
    this.ctx.blockConcurrencyWhile(async () => {
      const storedState = await this.ctx.storage.get<RoundState>("roundState");
      if (storedState === "lobby" || storedState === "playing") {
        // A round cannot survive hibernation (setInterval is lost),
        // so "playing" degrades to "lobby" on restart.
        this.roundState = "lobby";

        if (storedState === "playing") {
          // Persist the downgraded state
          await this.ctx.storage.put("roundState", "lobby");

          // Reset any surviving WebSocket attachments to lobby state
          // so player data is consistent with the lobby round state
          for (const ws of this.ctx.getWebSockets()) {
            const player = ws.deserializeAttachment() as Player | null;
            if (player && player.id) {
              ws.serializeAttachment({
                ...player,
                status: "lobby",
                role: null,
                position: null,
                direction: null,
              });
            }
          }

          // Notify surviving WebSocket clients that the round ended
          // (with hibernation, clients can stay connected across restarts)
          const roundEndPayload = JSON.stringify({
            type: "round_end",
            result: "cancelled",
            scores: {},
          });
          const roster: Player[] = [];
          for (const ws of this.ctx.getWebSockets()) {
            const player = ws.deserializeAttachment() as Player | null;
            if (player && player.id) {
              roster.push(player);
              try { ws.send(roundEndPayload); } catch { /* socket may be gone */ }
            }
          }
          const lobbyPayload = JSON.stringify({
            type: "lobby",
            players: roster,
          });
          for (const ws of this.ctx.getWebSockets()) {
            const player = ws.deserializeAttachment() as Player | null;
            if (player && player.id) {
              try { ws.send(lobbyPayload); } catch { /* socket may be gone */ }
            }
          }
        }
      } else {
        this.roundState = storedState ?? "stopped";
      }
      this.activeConfig = await this.getMergedConfig();
    });
  }

  async startServer(): Promise<{ ok: boolean; roundState: RoundState }> {
    if (this.roundState === "stopped") {
      // Complete all I/O before mutating in-memory state so a storage
      // failure doesn't leave the object in an inconsistent state.
      // Delete the alarm first — if this fails, storage still says "stopped"
      // and no in-memory state has changed, so the object stays consistent.
      const config = await this.getMergedConfig();
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.put("roundState", "lobby");
      this.roundState = "lobby";
      this.activeConfig = config;
    }
    return { ok: true, roundState: this.roundState };
  }

  async stopServer(): Promise<{ ok: boolean; roundState: RoundState }> {
    // Persist "stopped" to storage FIRST, before any side effects.
    // If this write fails, no clients are disconnected and in-memory
    // state is unchanged — the caller gets an error but the object
    // remains consistent. This mirrors the storage-first pattern
    // used in startServer() and startRound().
    await this.ctx.storage.put("roundState", "stopped");

    if (this.roundState === "playing") {
      // Force-end the round with round_end broadcast
      this.stopGameLoop();
      const scores: Record<string, number> = {};
      if (this.gameState) {
        for (const [id, score] of this.gameState.scores) {
          scores[id] = score;
        }
      }
      this.broadcast({ type: "round_end", result: "ghosts", scores });
      this.gameState = null;
    }

    this.roundState = "stopped";

    // Disconnect all WebSocket clients
    for (const ws of this.ctx.getWebSockets()) {
      const player = ws.deserializeAttachment() as Player | null;
      if (player && player.id) {
        try {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Server stopped",
            })
          );
        } catch {
          // Socket may have dropped
        }
      }
      ws.serializeAttachment(null);
      try {
        ws.close(1001, "Server stopped");
      } catch {
        // Already closed
      }
    }

    return { ok: true, roundState: "stopped" };
  }

  async getStatus(): Promise<{ roundState: RoundState; players: { id: string; name: string; role: Role | null; status: string }[]; config: GameConfig }> {
    const roster = this.getPlayerRoster();
    const players = roster.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      status: p.status,
    }));
    const config = await this.getMergedConfig();
    return { roundState: this.roundState, players, config };
  }

  async stopRound(): Promise<{ ok: boolean; roundState: RoundState; error?: string }> {
    if (this.roundState !== "playing") {
      return { ok: false, roundState: this.roundState, error: "No active round" };
    }
    await this.endRound("ghosts"); // Force-end defaults to ghosts win
    return { ok: true, roundState: this.roundState };
  }

  async updateConfig(overrides: Record<string, unknown>): Promise<{ ok: boolean; config: GameConfig; error?: string }> {
    // Validate by attempting merge (throws on invalid values/unknown keys)
    try {
      // Load existing overrides, sanitize legacy bad fields, then merge new ones on top
      const rawExisting = await this.ctx.storage.get<Partial<GameConfig>>("configOverrides") ?? {};
      const existing = sanitizeOverrides(rawExisting);
      const combined = { ...existing, ...overrides } as Partial<GameConfig>;
      const merged = mergeConfig(DEFAULTS, combined);
      await this.ctx.storage.put("configOverrides", combined);
      // Only update activeConfig if no round is in progress;
      // during play, config changes take effect at next round start
      if (this.roundState !== "playing") {
        this.activeConfig = merged;
      }
      return { ok: true, config: merged };
    } catch (err) {
      return { ok: false, config: this.activeConfig, error: (err as Error).message };
    }
  }

  private async getMergedConfig(): Promise<GameConfig> {
    const overrides = await this.ctx.storage.get<Partial<GameConfig>>("configOverrides");
    if (!overrides) return { ...DEFAULTS };
    // Sanitize stored overrides: drop any individual fields that fail validation
    // (e.g. legacy values that violate rules added after they were persisted)
    // rather than discarding the entire override blob.
    const sanitized = sanitizeOverrides(overrides);
    return { ...DEFAULTS, ...sanitized };
  }

  async fetch(request: Request): Promise<Response> {
    // Reject connections when server is stopped
    if (this.roundState === "stopped") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(
        JSON.stringify({
          type: "error",
          message: "Server is stopped",
        })
      );
      server.close(1008, "Server is stopped");
      return new Response(null, { status: 101, webSocket: client });
    }

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

  async startRound(): Promise<{ ok: boolean; error?: string }> {
    if (this.roundState === "stopped") {
      return { ok: false, error: "Server is stopped" };
    }

    if (this.roundState === "playing") {
      return { ok: false, error: "Round already in progress" };
    }

    const roster = this.getPlayerRoster();

    if (roster.length < 2) {
      return { ok: false, error: "Need at least 2 players to start" };
    }

    // Parse and validate map
    const map = parseCharGrid(DEFAULT_MAP);
    const validation = validateMap(map);
    if (!validation.valid) {
      return {
        ok: false,
        error: `Invalid map: ${validation.errors.join(", ")}`,
      };
    }

    // Load merged config and persist "playing" state before mutating
    // in-memory state, so a storage failure doesn't leave a half-started round.
    const config = await this.getMergedConfig();
    await this.ctx.storage.put("roundState", "playing");

    // All I/O succeeded — now commit in-memory state
    this.activeConfig = config;
    this.roundState = "playing";

    // Assign roles
    const playerIds = roster.map((p) => p.id);
    const roles = assignRoles(playerIds, config.pacmanCount);

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

    // Build player info for round_start message
    const playerInfos = Array.from(players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role as Role,
      position: p.position as { x: number; y: number },
    }));

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

    return { ok: true };
  }

  private startGameLoop(): void {
    const intervalMs = 1000 / this.activeConfig.tickRate;
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

    this.gameState = tick(this.gameState, this.activeConfig);

    const endCheck = checkRoundEnd(this.gameState);
    if (endCheck.ended) {
      void this.endRound(endCheck.result!).catch(() => {
        // endRound rejection (e.g. storage failure) — round state is already
        // cleaned up in memory by stopGameLoop/broadcastState; storage will
        // reconcile on next cold start.
      });
    } else {
      this.broadcastState();
    }
  }

  private async endRound(result: "pacman" | "ghosts"): Promise<void> {
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

    // Reset in-memory state first so the object is consistent
    // regardless of whether the storage write succeeds
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

    // Persist state — if this fails, in-memory state is already consistent
    // and storage will reconcile on next cold start
    await this.ctx.storage.put("roundState", this.roundState);
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
      timeElapsed: state.tick / this.activeConfig.tickRate,
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
      if (currentRoster.length >= this.activeConfig.maxPlayers) {
        ws.send(JSON.stringify({ type: "error", message: "Server is full" }));
        ws.close(1008, "Server is full");
        return;
      }

      // Cancel any pending idle shutdown alarm since a player is joining
      await this.ctx.storage.deleteAlarm();

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
    await this.cleanupPlayer(ws, code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    await this.cleanupPlayer(ws, 1011, "WebSocket error");
  }

  private async cleanupPlayer(ws: WebSocket, code: number, reason: string): Promise<void> {
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
            await this.endRound(endCheck.result!);
            // After endRound, check if we need to schedule idle shutdown
            await this.scheduleIdleShutdownIfEmpty();
            return;
          }
        }
        // Remove disconnected player from game state (keep scores for round_end)
        this.gameState.players.delete(player.id);
        this.gameState.respawnTimers.delete(player.id);
      }

      // Only broadcast lobby update when not in an active round
      if (this.roundState === "lobby") {
        this.broadcast({ type: "lobby", players: this.getPlayerRoster() });
      }

      // Schedule idle shutdown if no players remain
      await this.scheduleIdleShutdownIfEmpty();
    }
  }

  private async scheduleIdleShutdownIfEmpty(): Promise<void> {
    if (this.roundState === "stopped") return;
    const roster = this.getPlayerRoster();
    if (roster.length === 0) {
      const delayMs = this.activeConfig.idleShutdownMinutes * 60 * 1000;
      await this.ctx.storage.setAlarm(Date.now() + delayMs);
    }
  }

  async getAlarm(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  async alarm(): Promise<void> {
    // Race condition guard: only stop if still no players connected
    const roster = this.getPlayerRoster();
    if (roster.length === 0 && this.roundState !== "stopped") {
      await this.stopServer();
    }
  }
}
