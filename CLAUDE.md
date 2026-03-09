# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multiplayer Pacman game server for hackathons. Server-authoritative, built on Cloudflare Workers + Durable Objects. Participants build their own clients in 3 hours; the server handles all game logic.

**Status:** Phase 2 complete — game loop, grid movement, collision detection, round lifecycle all working on top of Phase 1 (WebSocket, lobby, player tracking, ping/pong, error handling).

## Architecture

- **Cloudflare Worker** — HTTP entrypoint at `GET /ws` (WebSocket upgrade); `/admin/*` planned for Phase 3
- **Single Durable Object** — holds all state: lobby, players, game loop, round lifecycle
- **Tick-based game loop** — `setInterval` inside the DO at 20 ticks/sec; pure-function tick pipeline (movement → collisions → timers → end check)
- **Server-authoritative** — clients send only `join` (Phase 1) and `input` direction (Phase 2); server computes all state
- **No persistent storage** — scores reset each round, no leaderboard

## Key Specs

- Full feature spec: `docs/specs/feature-list.md`
- Config defaults: `DEFAULTS` constant in `src/types.ts` (`tickRate: 20`, `powerPelletDuration: 100`, `ghostRespawnDelay: 60`); `maxPlayers: 10` and `pacmanCount: 1` hardcoded in `src/game-room.ts`
- Client protocol: 6 server message types (`welcome`, `lobby`, `round_start`, `state`, `round_end`, `error`), 2 client types (`join`, `input`)
- Server lifecycle: lobby → playing → lobby; admin API for start/stop planned for Phase 3
- Auto-shutdown via Cloudflare Alarm API after 3 hours with 0 players (planned)

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
│   ├── index.ts          # Worker entrypoint (routes /ws to DO, 404 otherwise)
│   ├── game-room.ts      # GameRoom Durable Object (lobby, WebSocket, round lifecycle)
│   ├── game-loop.ts      # Pure-function tick pipeline (movement, collision orchestration)
│   ├── map.ts            # Map parsing, validation, DEFAULT_MAP constant
│   ├── roles.ts          # Role assignment (pacman/ghost)
│   ├── collision.ts      # Dot, pellet, and player collision detection
│   └── types.ts          # Shared type definitions (Env, Player, GameState, messages)
└── test/
    ├── tsconfig.json      # Test-specific TS config
    ├── env.d.ts           # cloudflare:test type declarations
    ├── game-room.test.ts  # WebSocket, lobby, round start/end integration tests
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
