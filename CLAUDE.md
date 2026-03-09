# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multiplayer Pacman game server for hackathons. Server-authoritative, built on Cloudflare Workers + Durable Objects. Participants build their own clients in 3 hours; the server handles all game logic.

**Status:** Phase 3 complete — admin HTTP API, server lifecycle (stopped/lobby/playing), runtime config, auto-shutdown via Cloudflare Alarm API, all on top of Phase 2 (game loop, collisions, rounds) and Phase 1 (WebSocket, lobby, player tracking).

## Architecture

- **Cloudflare Worker** — HTTP entrypoint at `GET /ws` (WebSocket upgrade); `/admin/*` routes with Bearer token auth
- **Single Durable Object** — holds all state: lobby, players, game loop, round lifecycle, config overrides, alarm
- **Tick-based game loop** — `setInterval` inside the DO at configurable ticks/sec; pure-function tick pipeline (movement → collisions → timers → end check)
- **Server-authoritative** — clients send only `join` and `input` direction; server computes all state
- **DO storage** — config overrides persisted via `ctx.storage`; auto-shutdown alarm via Cloudflare Alarm API

## Key Specs

- Full feature spec: `docs/specs/feature-list.md`
- Config defaults: `DEFAULTS` constant in `src/types.ts` (`tickRate`, `powerPelletDuration`, `ghostRespawnDelay`, `maxPlayers`, `pacmanCount`, `idleShutdownMinutes`); runtime overrides via `PUT /admin/config`
- Client protocol: 6 server message types (`welcome`, `lobby`, `round_start`, `state`, `round_end`, `error`), 2 client types (`join`, `input`)
- Server lifecycle: stopped → lobby → playing → lobby; controlled via admin API (`/admin/server/start`, `/admin/server/stop`, `/admin/round/start`, `/admin/round/stop`)
- Auto-shutdown via Cloudflare Alarm API after configurable idle period (default 3 hours) with 0 players
- Admin auth: `ADMIN_API_KEY` env secret, Bearer token on all `/admin/*` routes

## Development Environment

- Devcontainer with Ubuntu 24.04, Node.js 22 LTS, Fish shell
- Port 8000 forwarded for local dev
- `./dev` script opens a Fish shell in the running devcontainer
- Wrangler CLI available for Cloudflare Workers development
- Use `/durable-objects`, `/wrangler`, `/cloudflare`, and `/workers-best-practices` skills when implementing Cloudflare-specific code

## Project Structure

```
├── package.json
├── tsconfig.json
├── wrangler.jsonc
├── vitest.config.ts
├── src/
│   ├── index.ts          # Worker entrypoint (routes /ws and /admin/*, auth middleware)
│   ├── game-room.ts      # GameRoom Durable Object (lobby, WebSocket, lifecycle, admin RPCs, alarm)
│   ├── game-loop.ts      # Pure-function tick pipeline (movement, collision orchestration)
│   ├── map.ts            # Map parsing, validation, DEFAULT_MAP constant
│   ├── roles.ts          # Role assignment (pacman/ghost)
│   ├── collision.ts      # Dot, pellet, and player collision detection
│   ├── config.ts         # Config merging and validation
│   └── types.ts          # Shared type definitions (Env, Player, GameState, messages, GameConfig)
└── test/
    ├── tsconfig.json      # Test-specific TS config
    ├── env.d.ts           # cloudflare:test type declarations
    ├── game-room.test.ts  # WebSocket, lobby, round start/end integration tests
    ├── admin.test.ts      # Admin API endpoint and auth tests
    ├── lifecycle.test.ts  # Server lifecycle and alarm tests
    ├── config.test.ts     # Config merging and validation tests
    ├── acceptance.test.ts # End-to-end acceptance tests
    ├── map.test.ts        # Map parsing and validation tests
    ├── roles.test.ts      # Role assignment tests
    ├── collision.test.ts  # Collision detection tests
    └── game-loop.test.ts  # Movement and tick pipeline tests
```

## Build Commands

- `npm test` — run all tests (Vitest + @cloudflare/vitest-pool-workers)
- `npm run test:watch` — run tests in watch mode
- `npm run dev` — start local dev server (wrangler dev, port 8000)
- `npm run deploy` — deploy to Cloudflare
