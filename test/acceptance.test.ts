import { describe, it, expect } from "vitest";
import { SELF, env, runDurableObjectAlarm } from "cloudflare:test";
import type { GameConfig } from "../src/types";
import { DEFAULTS } from "../src/types";

const VALID_TOKEN = "test-admin-key";

function adminFetch(path: string, options: RequestInit = {}) {
  return SELF.fetch(`http://fake-host${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${VALID_TOKEN}`,
      ...(options.headers || {}),
    },
  });
}

interface QueuedWebSocket {
  ws: WebSocket;
  messages: Record<string, unknown>[];
  waiters: Array<(msg: Record<string, unknown>) => void>;
}

function createQueuedWebSocket(ws: WebSocket): QueuedWebSocket {
  const q: QueuedWebSocket = { ws, messages: [], waiters: [] };
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data as string);
    const waiter = q.waiters.shift();
    if (waiter) {
      waiter(msg);
    } else {
      q.messages.push(msg);
    }
  });
  return q;
}

function nextMessage(q: QueuedWebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  const buffered = q.messages.shift();
  if (buffered) return Promise.resolve(buffered);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = q.waiters.indexOf(handler);
      if (idx !== -1) q.waiters.splice(idx, 1);
      reject(new Error(`No message received within ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (msg: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(msg);
    };
    q.waiters.push(handler);
  });
}

async function connectAndJoin(name: string): Promise<QueuedWebSocket> {
  const response = await SELF.fetch("http://fake-host/ws", {
    headers: { Upgrade: "websocket" },
  });
  const ws = response.webSocket!;
  ws.accept();
  const q = createQueuedWebSocket(ws);
  ws.send(JSON.stringify({ type: "join", name }));
  await nextMessage(q); // welcome
  await nextMessage(q); // lobby
  return q;
}

describe("Acceptance: full lifecycle", () => {
  it("start server -> connect players -> start round -> force-stop round -> players return to lobby", async () => {
    // Start server via admin API
    const startResp = await adminFetch("/admin/server/start", { method: "POST" });
    expect((await startResp.json<{ roundState: string }>()).roundState).toBe("lobby");

    // Connect two players
    const p1 = await connectAndJoin("Alice");
    const p2 = await connectAndJoin("Bob");

    // p1 gets lobby broadcast from p2 joining
    await nextMessage(p1);

    // Verify status shows 2 players in lobby
    const statusLobby = await adminFetch("/admin/status");
    const lobbyBody = await statusLobby.json<{ roundState: string; players: { name: string }[] }>();
    expect(lobbyBody.roundState).toBe("lobby");
    expect(lobbyBody.players).toHaveLength(2);

    // Start round via admin API
    const roundStartResp = await adminFetch("/admin/round/start", { method: "POST" });
    expect((await roundStartResp.json<{ roundState: string }>()).roundState).toBe("playing");

    // Both players receive round_start
    const rs1 = await nextMessage(p1);
    expect(rs1.type).toBe("round_start");
    const rs2 = await nextMessage(p2);
    expect(rs2.type).toBe("round_start");

    // Force-stop round via admin API
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName("default"));
    stub.stopGameLoop(); // prevent tick interference

    const roundStopResp = await adminFetch("/admin/round/stop", { method: "POST" });
    const roundStopBody = await roundStopResp.json<{ ok: boolean; roundState: string }>();
    expect(roundStopBody.ok).toBe(true);
    expect(roundStopBody.roundState).toBe("lobby");

    // Both players receive round_end then lobby
    const re1 = await nextMessage(p1);
    expect(re1.type).toBe("round_end");
    const lobby1 = await nextMessage(p1);
    expect(lobby1.type).toBe("lobby");

    const re2 = await nextMessage(p2);
    expect(re2.type).toBe("round_end");
    const lobby2 = await nextMessage(p2);
    expect(lobby2.type).toBe("lobby");

    // Verify server is back in lobby
    const statusAfter = await adminFetch("/admin/status");
    const afterBody = await statusAfter.json<{ roundState: string; players: { name: string }[] }>();
    expect(afterBody.roundState).toBe("lobby");
    expect(afterBody.players).toHaveLength(2);

    p1.ws.close();
    p2.ws.close();
  });
});

describe("Acceptance: config flow", () => {
  it("update config -> start round -> new settings apply in round_start message", async () => {
    // Update config before starting server
    const configResp = await adminFetch("/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickRate: 10, powerPelletDuration: 200 }),
    });
    const configBody = await configResp.json<{ ok: boolean; config: GameConfig }>();
    expect(configBody.ok).toBe(true);
    expect(configBody.config.tickRate).toBe(10);
    expect(configBody.config.powerPelletDuration).toBe(200);

    // Start server and connect players
    await adminFetch("/admin/server/start", { method: "POST" });
    const p1 = await connectAndJoin("ConfigP1");
    const p2 = await connectAndJoin("ConfigP2");
    await nextMessage(p1); // lobby broadcast from p2

    // Start round
    await adminFetch("/admin/round/start", { method: "POST" });

    // Verify round_start carries updated config
    const rs = await nextMessage(p1);
    expect(rs.type).toBe("round_start");
    const roundConfig = (rs as { config: GameConfig }).config;
    expect(roundConfig.tickRate).toBe(10);
    expect(roundConfig.powerPelletDuration).toBe(200);
    // Non-overridden values are defaults
    expect(roundConfig.ghostRespawnDelay).toBe(DEFAULTS.ghostRespawnDelay);
    expect(roundConfig.maxPlayers).toBe(DEFAULTS.maxPlayers);

    // Drain p2's round_start
    await nextMessage(p2);

    // Clean up
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName("default"));
    await stub.stopRound();
    p1.ws.close();
    p2.ws.close();
  });
});

describe("Acceptance: auth on all admin endpoints", () => {
  it("all admin endpoints reject requests without valid Bearer token", async () => {
    const endpoints = [
      { path: "/admin/status", method: "GET" },
      { path: "/admin/server/start", method: "POST" },
      { path: "/admin/server/stop", method: "POST" },
      { path: "/admin/round/start", method: "POST" },
      { path: "/admin/round/stop", method: "POST" },
      { path: "/admin/config", method: "PUT" },
    ];

    for (const { path, method } of endpoints) {
      // No header
      const noAuth = await SELF.fetch(`http://fake-host${path}`, { method });
      expect(noAuth.status).toBe(401);

      // Wrong token
      const badAuth = await SELF.fetch(`http://fake-host${path}`, {
        method,
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(badAuth.status).toBe(401);

      // Valid token works (PUT /admin/config needs a body)
      const fetchOpts: RequestInit = {
        method,
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      };
      if (method === "PUT") {
        (fetchOpts.headers as Record<string, string>)["Content-Type"] = "application/json";
        fetchOpts.body = JSON.stringify({ tickRate: 20 });
      }
      const goodAuth = await SELF.fetch(`http://fake-host${path}`, fetchOpts);
      expect(goodAuth.status).not.toBe(401);
    }
  });
});

describe("Acceptance: connection rejection when stopped", () => {
  it("stop server -> try to connect -> get error message", async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName("default"));

    // Start then stop server
    await stub.startServer();
    await stub.stopServer();

    // Try to connect
    const response = await SELF.fetch("http://fake-host/ws", {
      headers: { Upgrade: "websocket" },
    });
    const ws = response.webSocket!;
    ws.accept();
    const q = createQueuedWebSocket(ws);

    const msg = await nextMessage(q);
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Server is stopped");
  });
});

describe("Acceptance: auto-shutdown", () => {
  it("last player leaves -> alarm set; new player joins -> alarm cancelled", async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName("default"));
    await stub.startServer();

    // Player joins
    const p1 = await connectAndJoin("AutoP1");

    // Player leaves -> alarm should be set
    p1.ws.close();

    const alarm = await stub.getAlarm();
    expect(alarm).not.toBeNull();

    // New player joins -> alarm should be cancelled
    const p2 = await connectAndJoin("AutoP2");

    const alarmAfter = await stub.getAlarm();
    expect(alarmAfter).toBeNull();

    // Player leaves again -> alarm set again
    p2.ws.close();

    const alarmFinal = await stub.getAlarm();
    expect(alarmFinal).not.toBeNull();

    // Alarm fires -> server stops
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const status = await stub.getStatus();
    expect(status.roundState).toBe("stopped");
  });
});
