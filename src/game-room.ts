import { DurableObject } from "cloudflare:workers";
import type { Env, Player, ServerMessage } from "./types";

const MAX_PLAYERS = 10;
const MAX_NAME_LENGTH = 30;

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  async fetch(request: Request): Promise<Response> {
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

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
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
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      return;
    }

    if (data.type === "join") {
      // Check if already joined
      const existing = ws.deserializeAttachment() as Player | null;
      if (existing && existing.id) {
        ws.send(JSON.stringify({ type: "error", message: "Already joined" }));
        return;
      }

      // Validate name
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (!name) {
        ws.send(JSON.stringify({ type: "error", message: "Name is required" }));
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
      const player: Player = { id, name, status: "lobby" };
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
      ws.send(JSON.stringify({ type: "error", message: "Must join first" }));
      return;
    }

    // Unknown message type
    ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
    return;
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
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
      this.broadcast({ type: "lobby", players: this.getPlayerRoster() });
    }
  }
}
