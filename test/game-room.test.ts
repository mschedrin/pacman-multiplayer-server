import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("Worker", () => {
  it("responds 404 to HTTP request on /", async () => {
    const response = await SELF.fetch("http://fake-host/");
    expect(response.status).toBe(404);
  });

  it("returns 101 for GET /ws with upgrade header", async () => {
    const response = await SELF.fetch("http://fake-host/ws", {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();
  });

  it("returns 426 for GET /ws without upgrade header", async () => {
    const response = await SELF.fetch("http://fake-host/ws");
    expect(response.status).toBe(426);
  });

  it("returns 404 for unknown paths", async () => {
    const response = await SELF.fetch("http://fake-host/other");
    expect(response.status).toBe(404);
  });
});

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

describe("Join flow", () => {
  it("valid join receives welcome with player ID and roster", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "Alice" }));
    const msg = await msgPromise;

    expect(msg.type).toBe("welcome");
    expect(msg.id).toBeDefined();
    expect(typeof msg.id).toBe("string");
    expect(msg.name).toBe("Alice");
    expect(Array.isArray(msg.players)).toBe(true);
    const players = msg.players as Array<{ id: string; name: string; status: string }>;
    expect(players.length).toBe(1);
    expect(players[0].name).toBe("Alice");
    expect(players[0].id).toBe(msg.id);
    expect(players[0].status).toBe("lobby");

    ws.close();
  });

  it("join with empty name receives error", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "" }));
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Name is required");

    ws.close();
  });

  it("join with missing name receives error", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join" }));
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Name is required");

    ws.close();
  });

  it("join with whitespace-only name receives error", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "   " }));
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Name is required");

    ws.close();
  });

  it("duplicate join from same connection receives error", async () => {
    const ws = await connectWebSocket();

    // First join
    const firstPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "Alice" }));
    const firstMsg = await firstPromise;
    expect(firstMsg.type).toBe("welcome");

    // Consume lobby broadcast after join
    const lobbyMsg = await waitForMessage(ws);
    expect(lobbyMsg.type).toBe("lobby");

    // Second join
    const secondPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "Bob" }));
    const secondMsg = await secondPromise;
    expect(secondMsg.type).toBe("error");
    expect(secondMsg.message).toBe("Already joined");

    ws.close();
  });
});

describe("Lobby broadcast", () => {
  it("player A joins, player B joins, both receive lobby with 2 players", async () => {
    const wsA = await connectWebSocket();
    const welcomeAPromise = waitForMessage(wsA);
    wsA.send(JSON.stringify({ type: "join", name: "Alice" }));
    const welcomeA = await welcomeAPromise;
    expect(welcomeA.type).toBe("welcome");

    // Alice should also receive a lobby broadcast after her join
    const lobbyAfterAPromise = waitForMessage(wsA);
    const lobbyAfterA = await lobbyAfterAPromise;
    expect(lobbyAfterA.type).toBe("lobby");
    expect((lobbyAfterA.players as unknown[]).length).toBe(1);

    // Now Bob joins
    const wsB = await connectWebSocket();
    const welcomeBPromise = waitForMessage(wsB);
    const lobbyForAPromise = waitForMessage(wsA);
    wsB.send(JSON.stringify({ type: "join", name: "Bob" }));

    const welcomeB = await welcomeBPromise;
    expect(welcomeB.type).toBe("welcome");
    expect((welcomeB.players as unknown[]).length).toBe(2);

    // Bob gets lobby broadcast too
    const lobbyForBPromise = waitForMessage(wsB);
    const lobbyForB = await lobbyForBPromise;
    expect(lobbyForB.type).toBe("lobby");
    expect((lobbyForB.players as unknown[]).length).toBe(2);

    // Alice gets lobby broadcast with 2 players
    const lobbyForA = await lobbyForAPromise;
    expect(lobbyForA.type).toBe("lobby");
    expect((lobbyForA.players as unknown[]).length).toBe(2);

    wsA.close();
    wsB.close();
  });

  it("player disconnects, remaining players receive updated lobby", async () => {
    const wsA = await connectWebSocket();
    const welcomeAPromise = waitForMessage(wsA);
    wsA.send(JSON.stringify({ type: "join", name: "Alice" }));
    await welcomeAPromise;
    // Consume Alice's lobby broadcast
    await waitForMessage(wsA);

    const wsB = await connectWebSocket();
    const welcomeBPromise = waitForMessage(wsB);
    wsB.send(JSON.stringify({ type: "join", name: "Bob" }));
    await welcomeBPromise;
    // Consume lobby broadcasts for both
    await waitForMessage(wsA);
    await waitForMessage(wsB);

    // Bob disconnects - set up listener before closing
    const lobbyAfterDisconnect = waitForMessage(wsA);
    wsB.close(1000, "leaving");

    const msg = await lobbyAfterDisconnect;
    expect(msg.type).toBe("lobby");
    const players = msg.players as Array<{ name: string }>;
    expect(players.length).toBe(1);
    expect(players[0].name).toBe("Alice");
  });
});

describe("Max player cap", () => {
  it("10 players join successfully, 11th receives error and connection is closed", async () => {
    const queues: QueuedWebSocket[] = [];

    // Join 10 players using queued websockets
    for (let i = 0; i < 10; i++) {
      const ws = await connectWebSocket();
      const q = createQueuedWebSocket(ws);
      ws.send(JSON.stringify({ type: "join", name: `Player${i}` }));

      // Wait for welcome message for this player
      const welcome = await nextMessage(q);
      expect(welcome.type).toBe("welcome");

      // Wait for lobby broadcast for this player
      await nextMessage(q);

      // Drain lobby broadcasts from previously joined players
      for (const prev of queues) {
        await nextMessage(prev);
      }

      queues.push(q);
    }

    // 11th player should be rejected
    const ws11 = await connectWebSocket();
    const msgPromise = waitForMessage(ws11);
    ws11.send(JSON.stringify({ type: "join", name: "Player10" }));
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Server is full");

    // Clean up
    for (const q of queues) {
      q.ws.close();
    }
  }, 30000);

  it("player leaves, new player can join (count drops below cap)", async () => {
    const queues: QueuedWebSocket[] = [];

    // Join 10 players
    for (let i = 0; i < 10; i++) {
      const ws = await connectWebSocket();
      const q = createQueuedWebSocket(ws);
      ws.send(JSON.stringify({ type: "join", name: `Player${i}` }));

      const welcome = await nextMessage(q);
      expect(welcome.type).toBe("welcome");
      await nextMessage(q);

      for (const prev of queues) {
        await nextMessage(prev);
      }

      queues.push(q);
    }

    // Disconnect first player
    queues[0].ws.close(1000, "leaving");

    // Drain lobby broadcasts from remaining players
    for (let i = 1; i < queues.length; i++) {
      await nextMessage(queues[i]);
    }

    // Now a new player should be able to join
    const newWs = await connectWebSocket();
    const newQ = createQueuedWebSocket(newWs);
    newWs.send(JSON.stringify({ type: "join", name: "NewPlayer" }));

    const welcome = await nextMessage(newQ);
    expect(welcome.type).toBe("welcome");
    expect(welcome.name).toBe("NewPlayer");
    const roster = welcome.players as Array<{ name: string }>;
    expect(roster.length).toBe(10);

    // Clean up
    newWs.close();
    for (let i = 1; i < queues.length; i++) {
      queues[i].ws.close();
    }
  }, 30000);
});

describe("Error handling for malformed messages", () => {
  it("non-JSON message returns error", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send("this is not json{{{");
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Invalid JSON");

    ws.close();
  });

  it("unknown message type returns error", async () => {
    const ws = await connectWebSocket();

    // Join first
    const welcomePromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "Alice" }));
    await welcomePromise;
    // Consume lobby broadcast
    await waitForMessage(ws);

    // Send unknown type
    const errorPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "dance", move: "moonwalk" }));
    const msg = await errorPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Unknown message type");

    ws.close();
  });

  it("message before join returns 'Must join first' error", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "input", direction: "up" }));
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Must join first");

    ws.close();
  });
});

describe("Name validation", () => {
  it("name exceeding 30 characters receives error", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "A".repeat(31) }));
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Name too long");

    ws.close();
  });

  it("name at exactly 30 characters is accepted", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "join", name: "A".repeat(30) }));
    const msg = await msgPromise;

    expect(msg.type).toBe("welcome");

    ws.close();
  });
});

describe("Binary message handling", () => {
  it("binary ArrayBuffer message returns error", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send(new ArrayBuffer(8));
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Invalid message format");

    ws.close();
  });

  it("JSON null payload returns error instead of crashing", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send("null");
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Invalid message format");

    ws.close();
  });

  it("JSON array payload returns error", async () => {
    const ws = await connectWebSocket();
    const msgPromise = waitForMessage(ws);
    ws.send("[1,2,3]");
    const msg = await msgPromise;

    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Invalid message format");

    ws.close();
  });
});

describe("Heartbeat ping/pong", () => {
  it("ping returns pong as auto-response", async () => {
    const ws = await connectWebSocket();

    const pongPromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event) => {
        resolve(event.data as string);
      }, { once: true });
    });

    ws.send("ping");
    const response = await pongPromise;
    expect(response).toBe("pong");

    ws.close();
  });

  it("abnormal close triggers player cleanup and lobby broadcast", async () => {
    // Connect two players
    const wsA = await connectWebSocket();
    const qA = createQueuedWebSocket(wsA);
    wsA.send(JSON.stringify({ type: "join", name: "Alice" }));
    await nextMessage(qA); // welcome
    await nextMessage(qA); // lobby

    const wsB = await connectWebSocket();
    const qB = createQueuedWebSocket(wsB);
    wsB.send(JSON.stringify({ type: "join", name: "Bob" }));
    await nextMessage(qB); // welcome
    await nextMessage(qB); // lobby
    await nextMessage(qA); // lobby broadcast for Bob joining

    // Simulate Bob disconnecting unexpectedly
    wsB.close(1001, "Going away");

    // Alice should receive lobby update without Bob
    const lobbyUpdate = await nextMessage(qA);
    expect(lobbyUpdate.type).toBe("lobby");
    const players = lobbyUpdate.players as Array<{ name: string }>;
    expect(players.length).toBe(1);
    expect(players[0].name).toBe("Alice");

    wsA.close();
  });
});
