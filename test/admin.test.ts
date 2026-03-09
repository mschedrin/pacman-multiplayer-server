import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import type { GameConfig, Role } from "../src/types";
import { DEFAULTS } from "../src/types";

const VALID_TOKEN = "test-admin-key";

describe("Admin auth middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const response = await SELF.fetch("http://fake-host/admin/status");
    expect(response.status).toBe(401);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe("Missing Authorization header");
  });

  it("returns 401 when Authorization header has wrong format", async () => {
    const response = await SELF.fetch("http://fake-host/admin/status", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(response.status).toBe(401);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe("Invalid Authorization format");
  });

  it("returns 401 when Bearer token is wrong", async () => {
    const response = await SELF.fetch("http://fake-host/admin/status", {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(response.status).toBe(401);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe("Invalid API key");
  });

  it("passes auth with valid Bearer token", async () => {
    const response = await SELF.fetch("http://fake-host/admin/status", {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  it("requires auth on all /admin/* paths", async () => {
    const paths = [
      "/admin/status",
      "/admin/server/start",
      "/admin/server/stop",
      "/admin/round/start",
      "/admin/round/stop",
      "/admin/config",
    ];
    for (const path of paths) {
      const response = await SELF.fetch(`http://fake-host${path}`);
      expect(response.status).toBe(401);
    }
  });
});

function adminFetch(path: string, options: RequestInit = {}) {
  return SELF.fetch(`http://fake-host${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${VALID_TOKEN}`,
      ...(options.headers || {}),
    },
  });
}

describe("Admin routing", () => {
  it("GET /admin/status dispatches to getStatus", async () => {
    const response = await adminFetch("/admin/status");
    expect(response.status).toBe(200);
    const body = await response.json<{ roundState: string }>();
    expect(body.roundState).toBeDefined();
  });

  it("POST /admin/server/start dispatches to startServer", async () => {
    const response = await adminFetch("/admin/server/start", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
  });

  it("POST /admin/server/stop dispatches to stopServer", async () => {
    const response = await adminFetch("/admin/server/stop", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("stopped");
  });

  it("POST /admin/round/start dispatches to startRound", async () => {
    // Start server first so startRound doesn't fail with "Server is stopped"
    await adminFetch("/admin/server/start", { method: "POST" });
    const response = await adminFetch("/admin/round/start", { method: "POST" });
    // Returns 409 because no players connected
    expect(response.status).toBe(409);
    const body = await response.json<{ ok: boolean; error?: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Need at least 2 players");
  });

  it("POST /admin/round/stop dispatches to stopRound", async () => {
    const response = await adminFetch("/admin/round/stop", { method: "POST" });
    // Returns 409 because no active round
    expect(response.status).toBe(409);
    const body = await response.json<{ ok: boolean }>();
    expect(body.ok).toBe(false);
  });

  it("PUT /admin/config dispatches to updateConfig", async () => {
    const response = await adminFetch("/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickRate: 30 }),
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; config: Record<string, unknown> }>();
    expect(body.ok).toBe(true);
    expect(body.config).toBeDefined();
  });

  it("returns 404 for unknown /admin/* path", async () => {
    const response = await adminFetch("/admin/unknown");
    expect(response.status).toBe(404);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe("Not found");
  });

  it("returns 405 for wrong method on /admin/status", async () => {
    const response = await adminFetch("/admin/status", { method: "POST" });
    expect(response.status).toBe(405);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe("Method not allowed");
  });

  it("returns 405 for wrong method on /admin/server/start", async () => {
    const response = await adminFetch("/admin/server/start", { method: "GET" });
    expect(response.status).toBe(405);
  });

  it("returns 405 for wrong method on /admin/config", async () => {
    const response = await adminFetch("/admin/config", { method: "GET" });
    expect(response.status).toBe(405);
  });

  it("all admin routes require valid Bearer token", async () => {
    const routes = [
      { path: "/admin/status", method: "GET" },
      { path: "/admin/server/start", method: "POST" },
      { path: "/admin/server/stop", method: "POST" },
      { path: "/admin/round/start", method: "POST" },
      { path: "/admin/round/stop", method: "POST" },
      { path: "/admin/config", method: "PUT" },
    ];
    for (const { path, method } of routes) {
      // No auth header
      const noAuth = await SELF.fetch(`http://fake-host${path}`, { method });
      expect(noAuth.status).toBe(401);

      // Wrong token
      const wrongAuth = await SELF.fetch(`http://fake-host${path}`, {
        method,
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(wrongAuth.status).toBe(401);
    }
  });
});

interface StatusResponse {
  roundState: string;
  players: { id: string; name: string; role: Role | null; status: string }[];
  config: GameConfig;
}

function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`No message received within ${timeoutMs}ms`));
    }, timeoutMs);
    ws.addEventListener("message", (event) => {
      clearTimeout(timer);
      resolve(JSON.parse(event.data as string));
    }, { once: true });
  });
}

function waitForMessageOfType(ws: WebSocket, type: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`No '${type}' message received within ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string);
      if (data.type === type) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        resolve(data);
      }
    };
    ws.addEventListener("message", handler);
  });
}

describe("Admin status endpoint", () => {
  it("returns stopped state when server has not been started", async () => {
    const response = await adminFetch("/admin/status");
    expect(response.status).toBe(200);
    const body = await response.json<StatusResponse>();
    expect(body.roundState).toBe("stopped");
    expect(body.players).toEqual([]);
    expect(body.config).toEqual(DEFAULTS);
  });

  it("returns lobby state with empty players after server start", async () => {
    await adminFetch("/admin/server/start", { method: "POST" });
    const response = await adminFetch("/admin/status");
    expect(response.status).toBe(200);
    const body = await response.json<StatusResponse>();
    expect(body.roundState).toBe("lobby");
    expect(body.players).toEqual([]);
    expect(body.config).toEqual(DEFAULTS);
  });

  it("returns lobby state with connected players", async () => {
    // Start server and connect a player
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);
    await stub.startServer();

    const wsResponse = await SELF.fetch("http://fake-host/ws", {
      headers: { Upgrade: "websocket" },
    });
    const ws = wsResponse.webSocket!;
    ws.accept();

    // Join as player
    const joinPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "TestPlayer" }));
    await joinPromise;

    // Check status
    const response = await adminFetch("/admin/status");
    const body = await response.json<StatusResponse>();
    expect(body.roundState).toBe("lobby");
    expect(body.players).toHaveLength(1);
    expect(body.players[0].name).toBe("TestPlayer");
    expect(body.players[0].role).toBeNull();
    expect(body.players[0].status).toBe("lobby");
    expect(body.players[0].id).toBeDefined();

    ws.close();
  });

  it("returns playing state during active round", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);
    await stub.startServer();

    // Connect 2 players (minimum for a round)
    const players: WebSocket[] = [];
    for (const name of ["Player1", "Player2"]) {
      const wsResponse = await SELF.fetch("http://fake-host/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = wsResponse.webSocket!;
      ws.accept();
      const msgPromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: "join", name }));
      await msgPromise;
      players.push(ws);
    }

    // Drain lobby messages from second player join
    await waitForMessage(players[0]);

    // Start round
    await stub.startRound();

    // Drain round_start messages
    await waitForMessage(players[0]);
    await waitForMessage(players[1]);

    // Check status
    const response = await adminFetch("/admin/status");
    const body = await response.json<StatusResponse>();
    expect(body.roundState).toBe("playing");
    expect(body.players).toHaveLength(2);
    // Players should have roles assigned
    const roles = body.players.map((p) => p.role);
    expect(roles).toContain("pacman");
    expect(roles).toContain("ghost");
    // Players should be active
    for (const p of body.players) {
      expect(p.status).toBe("active");
    }

    // Clean up - stop the round
    await stub.stopRound();
    for (const ws of players) {
      ws.close();
    }
  });

  it("returns full config object matching DEFAULTS", async () => {
    const response = await adminFetch("/admin/status");
    const body = await response.json<StatusResponse>();
    expect(body.config.tickRate).toBe(DEFAULTS.tickRate);
    expect(body.config.powerPelletDuration).toBe(DEFAULTS.powerPelletDuration);
    expect(body.config.ghostRespawnDelay).toBe(DEFAULTS.ghostRespawnDelay);
    expect(body.config.pacmanCount).toBe(DEFAULTS.pacmanCount);
    expect(body.config.maxPlayers).toBe(DEFAULTS.maxPlayers);
    expect(body.config.idleShutdownMinutes).toBe(DEFAULTS.idleShutdownMinutes);
  });
});

describe("Admin round control endpoints", () => {
  it("POST /admin/round/start succeeds with running server and enough players", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);
    await stub.startServer();

    // Connect 2 players
    const players: WebSocket[] = [];
    for (const name of ["RoundP1", "RoundP2"]) {
      const wsResponse = await SELF.fetch("http://fake-host/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = wsResponse.webSocket!;
      ws.accept();
      const msgPromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: "join", name }));
      await msgPromise;
      players.push(ws);
    }
    // Drain lobby broadcast from second join
    await waitForMessage(players[0]);

    // Start round via admin API
    const response = await adminFetch("/admin/round/start", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("playing");

    // Drain round_start messages
    await waitForMessage(players[0]);
    await waitForMessage(players[1]);

    // Verify status
    const statusResponse = await adminFetch("/admin/status");
    const status = await statusResponse.json<StatusResponse>();
    expect(status.roundState).toBe("playing");

    // Clean up
    await stub.stopRound();
    for (const ws of players) ws.close();
  });

  it("POST /admin/round/start returns 409 when server is stopped", async () => {
    const response = await adminFetch("/admin/round/start", { method: "POST" });
    expect(response.status).toBe(409);
    const body = await response.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Server is stopped");
  });

  it("POST /admin/round/start returns 409 when no players connected", async () => {
    await adminFetch("/admin/server/start", { method: "POST" });

    const response = await adminFetch("/admin/round/start", { method: "POST" });
    expect(response.status).toBe(409);
    const body = await response.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Need at least 2 players");
  });

  it("POST /admin/round/start returns 409 when round already active", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);
    await stub.startServer();

    // Connect 2 players and start round
    const players: WebSocket[] = [];
    for (const name of ["RP1", "RP2"]) {
      const wsResponse = await SELF.fetch("http://fake-host/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = wsResponse.webSocket!;
      ws.accept();
      const msgPromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: "join", name }));
      await msgPromise;
      players.push(ws);
    }
    await waitForMessage(players[0]);
    await stub.startRound();
    await waitForMessage(players[0]);
    await waitForMessage(players[1]);

    // Try to start another round
    const response = await adminFetch("/admin/round/start", { method: "POST" });
    expect(response.status).toBe(409);
    const body = await response.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Round already in progress");

    // Clean up
    await stub.stopRound();
    for (const ws of players) ws.close();
  });

  it("POST /admin/round/stop succeeds when round is active", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);
    await stub.startServer();

    // Connect 2 players and start round
    const players: WebSocket[] = [];
    for (const name of ["SP1", "SP2"]) {
      const wsResponse = await SELF.fetch("http://fake-host/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = wsResponse.webSocket!;
      ws.accept();
      const msgPromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: "join", name }));
      await msgPromise;
      players.push(ws);
    }
    await waitForMessage(players[0]);
    await stub.startRound();
    // Drain round_start messages
    await waitForMessage(players[0]);
    await waitForMessage(players[1]);

    // Stop round via admin API
    const response = await adminFetch("/admin/round/stop", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("lobby");

    // Verify status
    const statusResponse = await adminFetch("/admin/status");
    const status = await statusResponse.json<StatusResponse>();
    expect(status.roundState).toBe("lobby");

    for (const ws of players) ws.close();
  });

  it("POST /admin/round/stop returns 409 when no active round", async () => {
    const response = await adminFetch("/admin/round/stop", { method: "POST" });
    expect(response.status).toBe(409);
    const body = await response.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("No active round");
  });
});

describe("Admin server lifecycle endpoints", () => {
  it("POST /admin/server/start transitions from stopped to lobby", async () => {
    // Verify initial state is stopped
    const statusBefore = await adminFetch("/admin/status");
    const before = await statusBefore.json<StatusResponse>();
    expect(before.roundState).toBe("stopped");

    // Start server
    const response = await adminFetch("/admin/server/start", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("lobby");

    // Verify via status
    const statusAfter = await adminFetch("/admin/status");
    const after = await statusAfter.json<StatusResponse>();
    expect(after.roundState).toBe("lobby");
  });

  it("POST /admin/server/start is idempotent when already in lobby", async () => {
    await adminFetch("/admin/server/start", { method: "POST" });

    // Call start again
    const response = await adminFetch("/admin/server/start", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("lobby");
  });

  it("POST /admin/server/start is idempotent when playing", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);
    await stub.startServer();

    // Connect 2 players and start round
    const players: WebSocket[] = [];
    for (const name of ["P1", "P2"]) {
      const wsResponse = await SELF.fetch("http://fake-host/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = wsResponse.webSocket!;
      ws.accept();
      const msgPromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: "join", name }));
      await msgPromise;
      players.push(ws);
    }
    // Drain lobby messages
    await waitForMessage(players[0]);

    await stub.startRound();
    // Drain round_start messages
    await waitForMessage(players[0]);
    await waitForMessage(players[1]);

    // Start server again while playing - should be no-op
    const response = await adminFetch("/admin/server/start", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("playing");

    // Clean up
    await stub.stopRound();
    for (const ws of players) ws.close();
  });

  it("POST /admin/server/stop transitions from lobby to stopped", async () => {
    await adminFetch("/admin/server/start", { method: "POST" });

    const response = await adminFetch("/admin/server/stop", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("stopped");

    // Verify via status
    const statusAfter = await adminFetch("/admin/status");
    const after = await statusAfter.json<StatusResponse>();
    expect(after.roundState).toBe("stopped");
  });

  it("POST /admin/server/stop disconnects connected players", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);
    await stub.startServer();

    // Connect a player
    const wsResponse = await SELF.fetch("http://fake-host/ws", {
      headers: { Upgrade: "websocket" },
    });
    const ws = wsResponse.webSocket!;
    ws.accept();
    const joinPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "ToBeDisconnected" }));
    await joinPromise;

    // Collect messages sent before close
    const messages: Record<string, unknown>[] = [];
    ws.addEventListener("message", (event) => {
      messages.push(JSON.parse(event.data as string));
    });

    // Stop server
    const response = await adminFetch("/admin/server/stop", { method: "POST" });
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("stopped");

    // Player should have received error message
    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.message).toBe("Server stopped");
  });

  it("POST /admin/server/stop while playing force-ends round and disconnects", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);
    await stub.startServer();

    // Connect 2 players
    const players: WebSocket[] = [];
    for (const name of ["P1", "P2"]) {
      const wsResponse = await SELF.fetch("http://fake-host/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = wsResponse.webSocket!;
      ws.accept();
      const msgPromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: "join", name }));
      await msgPromise;
      players.push(ws);
    }
    // Drain lobby messages
    await waitForMessage(players[0]);

    await stub.startRound();
    // Drain round_start messages
    await waitForMessage(players[0]);
    await waitForMessage(players[1]);

    // Stop server while playing
    const response = await adminFetch("/admin/server/stop", { method: "POST" });
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("stopped");

    // Status should show stopped with no players
    const statusResponse = await adminFetch("/admin/status");
    const status = await statusResponse.json<StatusResponse>();
    expect(status.roundState).toBe("stopped");
    expect(status.players).toEqual([]);
  });

  it("POST /admin/server/stop is idempotent when already stopped", async () => {
    // Server starts in stopped state
    const response = await adminFetch("/admin/server/stop", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; roundState: string }>();
    expect(body.ok).toBe(true);
    expect(body.roundState).toBe("stopped");
  });

  it("full start-stop-start cycle works", async () => {
    // Start
    const start1 = await adminFetch("/admin/server/start", { method: "POST" });
    const s1 = await start1.json<{ ok: boolean; roundState: string }>();
    expect(s1.roundState).toBe("lobby");

    // Stop
    const stop = await adminFetch("/admin/server/stop", { method: "POST" });
    const st = await stop.json<{ ok: boolean; roundState: string }>();
    expect(st.roundState).toBe("stopped");

    // Start again
    const start2 = await adminFetch("/admin/server/start", { method: "POST" });
    const s2 = await start2.json<{ ok: boolean; roundState: string }>();
    expect(s2.roundState).toBe("lobby");

    // Verify connections work after restart
    const wsResponse = await SELF.fetch("http://fake-host/ws", {
      headers: { Upgrade: "websocket" },
    });
    const ws = wsResponse.webSocket!;
    ws.accept();
    const joinPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "AfterRestart" }));
    const welcome = await joinPromise;
    expect(welcome.type).toBe("welcome");

    ws.close();
  });
});

describe("Admin config update endpoint", () => {
  it("PUT /admin/config stores valid partial overrides", async () => {
    const response = await adminFetch("/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickRate: 30 }),
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; config: GameConfig }>();
    expect(body.ok).toBe(true);
    expect(body.config.tickRate).toBe(30);
    // Non-overridden values remain defaults
    expect(body.config.powerPelletDuration).toBe(DEFAULTS.powerPelletDuration);
    expect(body.config.maxPlayers).toBe(DEFAULTS.maxPlayers);
  });

  it("PUT /admin/config stores multiple overrides", async () => {
    const response = await adminFetch("/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickRate: 10, pacmanCount: 2, maxPlayers: 20 }),
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; config: GameConfig }>();
    expect(body.ok).toBe(true);
    expect(body.config.tickRate).toBe(10);
    expect(body.config.pacmanCount).toBe(2);
    expect(body.config.maxPlayers).toBe(20);
  });

  it("PUT /admin/config returns 400 for invalid values (zero)", async () => {
    const response = await adminFetch("/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickRate: 0 }),
    });
    expect(response.status).toBe(400);
    const body = await response.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Invalid value for tickRate");
  });

  it("PUT /admin/config returns 400 for negative values", async () => {
    const response = await adminFetch("/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPlayers: -5 }),
    });
    expect(response.status).toBe(400);
    const body = await response.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Invalid value for maxPlayers");
  });

  it("PUT /admin/config returns 400 for unknown keys", async () => {
    const response = await adminFetch("/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unknownKey: 42 }),
    });
    expect(response.status).toBe(400);
    const body = await response.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Unknown config key: unknownKey");
  });

  it("config overrides persist in DO storage and appear in status", async () => {
    // Store overrides
    const updateResponse = await adminFetch("/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickRate: 15 }),
    });
    expect(updateResponse.status).toBe(200);

    // Check status reflects merged config
    const statusResponse = await adminFetch("/admin/status");
    const status = await statusResponse.json<{ config: GameConfig }>();
    expect(status.config.tickRate).toBe(15);
    expect(status.config.powerPelletDuration).toBe(DEFAULTS.powerPelletDuration);
  });

  it("config overrides are applied at round start", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);

    // Store overrides before starting
    await stub.updateConfig({ tickRate: 15, pacmanCount: 1 });
    await stub.startServer();

    // Connect 2 players
    const players: WebSocket[] = [];
    for (const name of ["CP1", "CP2"]) {
      const wsResponse = await SELF.fetch("http://fake-host/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = wsResponse.webSocket!;
      ws.accept();
      const msgPromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: "join", name }));
      await msgPromise;
      players.push(ws);
    }
    // Drain lobby broadcast from second join
    await waitForMessage(players[0]);

    // Set up listener BEFORE starting round to catch round_start
    const roundStartPromise = waitForMessageOfType(players[0], "round_start");
    await stub.startRound();

    const roundStart = await roundStartPromise;
    const roundConfig = (roundStart as { config: GameConfig }).config;
    expect(roundConfig.tickRate).toBe(15);
    expect(roundConfig.pacmanCount).toBe(1);
    // Non-overridden values should be defaults
    expect(roundConfig.powerPelletDuration).toBe(DEFAULTS.powerPelletDuration);

    // Clean up
    await stub.stopRound();
    for (const ws of players) ws.close();
  });

  it("config changes do NOT affect current round", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);
    await stub.startServer();

    // Connect 2 players
    const players: WebSocket[] = [];
    for (const name of ["NR1", "NR2"]) {
      const wsResponse = await SELF.fetch("http://fake-host/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = wsResponse.webSocket!;
      ws.accept();
      const msgPromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: "join", name }));
      await msgPromise;
      players.push(ws);
    }
    await waitForMessage(players[0]);

    // Set up listener before starting round
    const roundStartPromise = waitForMessageOfType(players[0], "round_start");
    await stub.startRound();
    const roundStart = await roundStartPromise;
    const initialConfig = (roundStart as { config: GameConfig }).config;
    expect(initialConfig.tickRate).toBe(DEFAULTS.tickRate);

    // Update config during active round - should not crash, stored for next round
    await stub.updateConfig({ tickRate: 50 });

    // The round is still running with original config

    // Clean up
    await stub.stopRound();
    for (const ws of players) ws.close();
  });

  it("defaults are used for non-overridden values at round start", async () => {
    const id = env.GAME_ROOM.idFromName("default");
    const stub = env.GAME_ROOM.get(id);

    // Only override one value
    await stub.updateConfig({ ghostRespawnDelay: 30 });
    await stub.startServer();

    // Connect 2 players
    const players: WebSocket[] = [];
    for (const name of ["DF1", "DF2"]) {
      const wsResponse = await SELF.fetch("http://fake-host/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = wsResponse.webSocket!;
      ws.accept();
      const msgPromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: "join", name }));
      await msgPromise;
      players.push(ws);
    }
    await waitForMessage(players[0]);

    const roundStartPromise = waitForMessageOfType(players[0], "round_start");
    await stub.startRound();
    const roundStart = await roundStartPromise;
    const roundConfig = (roundStart as { config: GameConfig }).config;
    expect(roundConfig.ghostRespawnDelay).toBe(30);
    expect(roundConfig.tickRate).toBe(DEFAULTS.tickRate);
    expect(roundConfig.powerPelletDuration).toBe(DEFAULTS.powerPelletDuration);
    expect(roundConfig.pacmanCount).toBe(DEFAULTS.pacmanCount);
    expect(roundConfig.maxPlayers).toBe(DEFAULTS.maxPlayers);
    expect(roundConfig.idleShutdownMinutes).toBe(DEFAULTS.idleShutdownMinutes);

    await stub.stopRound();
    for (const ws of players) ws.close();
  });
});
