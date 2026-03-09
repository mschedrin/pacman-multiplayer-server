import type { Env } from "./types";

export { GameRoom } from "./game-room";

export function checkAdminAuth(request: Request, env: Env): Response | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Missing Authorization header" }, { status: 401 });
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) {
    return Response.json({ error: "Invalid Authorization format" }, { status: 401 });
  }
  if (match[1] !== env.ADMIN_API_KEY) {
    return Response.json({ error: "Invalid API key" }, { status: 401 });
  }
  return null; // auth passed
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const id = env.GAME_ROOM.idFromName("default");
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    if (url.pathname.startsWith("/admin/") || url.pathname === "/admin") {
      const authError = checkAdminAuth(request, env);
      if (authError) return authError;

      const id = env.GAME_ROOM.idFromName("default");
      const stub = env.GAME_ROOM.get(id);

      if (url.pathname === "/admin/status") {
        if (request.method !== "GET") {
          return Response.json({ error: "Method not allowed" }, { status: 405 });
        }
        const result = await stub.getStatus();
        return Response.json(result);
      }

      if (url.pathname === "/admin/server/start") {
        if (request.method !== "POST") {
          return Response.json({ error: "Method not allowed" }, { status: 405 });
        }
        const result = await stub.startServer();
        return Response.json(result);
      }

      if (url.pathname === "/admin/server/stop") {
        if (request.method !== "POST") {
          return Response.json({ error: "Method not allowed" }, { status: 405 });
        }
        const result = await stub.stopServer();
        return Response.json(result);
      }

      if (url.pathname === "/admin/round/start") {
        if (request.method !== "POST") {
          return Response.json({ error: "Method not allowed" }, { status: 405 });
        }
        const result = await stub.startRound();
        if (!result.ok) {
          return Response.json({ ok: false, error: result.error }, { status: 409 });
        }
        return Response.json({ ok: true, roundState: "playing" });
      }

      if (url.pathname === "/admin/round/stop") {
        if (request.method !== "POST") {
          return Response.json({ error: "Method not allowed" }, { status: 405 });
        }
        const result = await stub.stopRound();
        if (!result.ok) {
          return Response.json({ ok: false, error: result.error }, { status: 409 });
        }
        return Response.json({ ok: true, roundState: result.roundState });
      }

      if (url.pathname === "/admin/config") {
        if (request.method !== "PUT") {
          return Response.json({ error: "Method not allowed" }, { status: 405 });
        }
        let body: Record<string, unknown>;
        try {
          body = await request.json<Record<string, unknown>>();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
        }
        const result = await stub.updateConfig(body);
        if (!result.ok) {
          return Response.json({ ok: false, error: result.error }, { status: 400 });
        }
        return Response.json({ ok: true, config: result.config });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
