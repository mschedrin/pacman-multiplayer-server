import { describe, it, expect } from "vitest";
import { SELF, env, runDurableObjectAlarm } from "cloudflare:test";

function getStub() {
  const id = env.GAME_ROOM.idFromName("default");
  return env.GAME_ROOM.get(id);
}

async function connectWebSocket(): Promise<WebSocket> {
  const response = await SELF.fetch("http://fake-host/ws", {
    headers: { Upgrade: "websocket" },
  });
  const ws = response.webSocket!;
  ws.accept();
  return ws;
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

describe("Server lifecycle — startServer / stopServer", () => {
  it("initial state is stopped", async () => {
    const stub = getStub();
    // Trying to start a round on a stopped server should fail
    const result = await stub.startRound();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Server is stopped");
  });

  it("startServer transitions from stopped to lobby", async () => {
    const stub = getStub();
    const result = await stub.startServer();
    expect(result.ok).toBe(true);
    expect(result.roundState).toBe("lobby");
  });

  it("startServer is idempotent when already in lobby", async () => {
    const stub = getStub();
    await stub.startServer();
    const result = await stub.startServer();
    expect(result.ok).toBe(true);
    expect(result.roundState).toBe("lobby");
  });

  it("startServer is no-op when in playing state", async () => {
    const stub = getStub();
    await stub.startServer();

    // Join 2 players and start a round
    const ws1 = await connectWebSocket();
    const q1 = createQueuedWebSocket(ws1);
    ws1.send(JSON.stringify({ type: "join", name: "Alice" }));
    await nextMessage(q1); // welcome
    await nextMessage(q1); // lobby

    const ws2 = await connectWebSocket();
    const q2 = createQueuedWebSocket(ws2);
    ws2.send(JSON.stringify({ type: "join", name: "Bob" }));
    await nextMessage(q2); // welcome
    await nextMessage(q2); // lobby
    await nextMessage(q1); // lobby broadcast

    await stub.startRound();
    await nextMessage(q1); // round_start
    await nextMessage(q2); // round_start

    const result = await stub.startServer();
    expect(result.ok).toBe(true);
    expect(result.roundState).toBe("playing");

    ws1.close();
    ws2.close();
  });

  it("stopServer transitions from lobby to stopped", async () => {
    const stub = getStub();
    await stub.startServer();
    const result = await stub.stopServer();
    expect(result.ok).toBe(true);
    expect(result.roundState).toBe("stopped");
  });

  it("stopServer disconnects all connected clients", async () => {
    const stub = getStub();
    await stub.startServer();

    const ws = await connectWebSocket();
    const q = createQueuedWebSocket(ws);
    ws.send(JSON.stringify({ type: "join", name: "Alice" }));
    await nextMessage(q); // welcome
    await nextMessage(q); // lobby

    await stub.stopServer();

    // Client should receive error message about server stopping
    const msg = await nextMessage(q);
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Server stopped");
  });

  it("stopServer force-ends active round and disconnects clients", async () => {
    const stub = getStub();
    await stub.startServer();

    const ws1 = await connectWebSocket();
    const q1 = createQueuedWebSocket(ws1);
    ws1.send(JSON.stringify({ type: "join", name: "Alice" }));
    await nextMessage(q1); // welcome
    await nextMessage(q1); // lobby

    const ws2 = await connectWebSocket();
    const q2 = createQueuedWebSocket(ws2);
    ws2.send(JSON.stringify({ type: "join", name: "Bob" }));
    await nextMessage(q2); // welcome
    await nextMessage(q2); // lobby
    await nextMessage(q1); // lobby broadcast

    await stub.startRound();
    await nextMessage(q1); // round_start
    await nextMessage(q2); // round_start

    stub.stopGameLoop(); // prevent tick interference

    await stub.stopServer();

    // Both clients should receive round_end (from force-ending the round) then error
    const roundEnd1 = await nextMessage(q1);
    expect(roundEnd1.type).toBe("round_end");
    expect(roundEnd1.result).toBe("ghosts");

    const roundEnd2 = await nextMessage(q2);
    expect(roundEnd2.type).toBe("round_end");
    expect(roundEnd2.result).toBe("ghosts");

    const msg1 = await nextMessage(q1);
    expect(msg1.type).toBe("error");
    expect(msg1.message).toBe("Server stopped");

    const msg2 = await nextMessage(q2);
    expect(msg2.type).toBe("error");
    expect(msg2.message).toBe("Server stopped");

    // Server should now be in stopped state
    const startResult = await stub.startRound();
    expect(startResult.ok).toBe(false);
    expect(startResult.error).toBe("Server is stopped");
  });

  it("stopServer on already stopped server is idempotent", async () => {
    const stub = getStub();
    const result = await stub.stopServer();
    expect(result.ok).toBe(true);
    expect(result.roundState).toBe("stopped");
  });
});

describe("Auto-shutdown via Alarm API", () => {
  it("sets alarm when last player disconnects in lobby", async () => {
    const stub = getStub();
    await stub.startServer();

    const ws = await connectWebSocket();
    const q = createQueuedWebSocket(ws);
    ws.send(JSON.stringify({ type: "join", name: "Alice" }));
    await nextMessage(q); // welcome
    await nextMessage(q); // lobby

    // Disconnect — player count drops to 0
    ws.close();

    // Verify alarm was set by checking storage
    const alarm = await stub.getAlarm();
    expect(alarm).not.toBeNull();
    expect(alarm).toBeGreaterThan(Date.now());
  });

  it("cancels alarm when new player joins", async () => {
    const stub = getStub();
    await stub.startServer();

    // First player joins and leaves — alarm should be set
    const ws1 = await connectWebSocket();
    const q1 = createQueuedWebSocket(ws1);
    ws1.send(JSON.stringify({ type: "join", name: "Alice" }));
    await nextMessage(q1); // welcome
    await nextMessage(q1); // lobby
    ws1.close();

    const alarmAfterDisconnect = await stub.getAlarm();
    expect(alarmAfterDisconnect).not.toBeNull();

    // New player connects and joins — alarm should be cancelled
    const ws2 = await connectWebSocket();
    const q2 = createQueuedWebSocket(ws2);
    ws2.send(JSON.stringify({ type: "join", name: "Bob" }));
    await nextMessage(q2); // welcome
    await nextMessage(q2); // lobby

    const alarmAfterJoin = await stub.getAlarm();
    expect(alarmAfterJoin).toBeNull();

    ws2.close();
  });

  it("alarm handler stops server when 0 players", async () => {
    const stub = getStub();
    await stub.startServer();

    // Join and leave to trigger alarm
    const ws = await connectWebSocket();
    const q = createQueuedWebSocket(ws);
    ws.send(JSON.stringify({ type: "join", name: "Alice" }));
    await nextMessage(q); // welcome
    await nextMessage(q); // lobby
    ws.close();

    // Trigger alarm handler via test helper
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    // Server should now be stopped
    const status = await stub.getStatus();
    expect(status.roundState).toBe("stopped");
  });

  it("alarm handler is no-op when players are connected", async () => {
    const stub = getStub();
    await stub.startServer();

    // First join and leave to set an alarm
    const ws1 = await connectWebSocket();
    const q1 = createQueuedWebSocket(ws1);
    ws1.send(JSON.stringify({ type: "join", name: "Alice" }));
    await nextMessage(q1); // welcome
    await nextMessage(q1); // lobby
    ws1.close();

    // Now a new player joins — alarm should be cancelled
    const ws2 = await connectWebSocket();
    const q2 = createQueuedWebSocket(ws2);
    ws2.send(JSON.stringify({ type: "join", name: "Bob" }));
    await nextMessage(q2); // welcome
    await nextMessage(q2); // lobby

    // Alarm should have been cancelled, so runDurableObjectAlarm returns false
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(false);

    // Server should still be running
    const status = await stub.getStatus();
    expect(status.roundState).toBe("lobby");

    ws2.close();
  });

  it("does not set alarm when server is stopped", async () => {
    const stub = getStub();
    // Server starts in stopped state, connect and disconnect
    // The connection will be rejected, so no player is created
    const ws = await connectWebSocket();
    await waitForMessage(ws); // error: server is stopped

    const alarm = await stub.getAlarm();
    expect(alarm).toBeNull();
  });

  it("uses idleShutdownMinutes from config for alarm delay", async () => {
    const stub = getStub();
    // Set a custom idleShutdownMinutes
    await stub.startServer();
    await stub.updateConfig({ idleShutdownMinutes: 30 });
    // Reload config
    await stub.stopServer();
    await stub.startServer();

    const ws = await connectWebSocket();
    const q = createQueuedWebSocket(ws);
    ws.send(JSON.stringify({ type: "join", name: "Alice" }));
    await nextMessage(q); // welcome
    await nextMessage(q); // lobby
    ws.close();

    const alarm = await stub.getAlarm();
    expect(alarm).not.toBeNull();
    // 30 minutes = 1,800,000 ms; allow 5 second tolerance
    const expectedDelay = 30 * 60 * 1000;
    const actualDelay = alarm! - Date.now();
    expect(actualDelay).toBeGreaterThan(expectedDelay - 5000);
    expect(actualDelay).toBeLessThanOrEqual(expectedDelay + 5000);
  });
});

describe("Connection rejection when stopped", () => {
  it("WebSocket connection when stopped receives error and closes", async () => {
    // Do NOT start server — it starts in stopped state
    const ws = await connectWebSocket();
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Server is stopped");
  });

  it("after stopServer, new connections are rejected", async () => {
    const stub = getStub();
    await stub.startServer();
    await stub.stopServer();

    const ws = await connectWebSocket();
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Server is stopped");
  });

  it("after stopServer then startServer, connections work again", async () => {
    const stub = getStub();
    await stub.startServer();
    await stub.stopServer();
    await stub.startServer();

    const ws = await connectWebSocket();
    const q = createQueuedWebSocket(ws);
    ws.send(JSON.stringify({ type: "join", name: "Alice" }));
    const msg = await nextMessage(q);
    expect(msg.type).toBe("welcome");
    expect(msg.name).toBe("Alice");

    ws.close();
  });
});
