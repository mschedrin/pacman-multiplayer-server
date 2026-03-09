# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multiplayer Pacman game server for hackathons. Server-authoritative, built on Cloudflare Workers + Durable Objects. Participants build their own clients in 3 hours; the server handles all game logic.

**Status:** Phase 1 complete — WebSocket connections, lobby, player tracking, ping/pong, error handling all working. Phase 2 (game logic) not started.

## Architecture

- **Cloudflare Worker** — HTTP entrypoint at `GET /ws` (WebSocket upgrade); `/admin/*` planned for Phase 3
- **Single Durable Object** — holds all state: lobby, players (game loop and round lifecycle planned for Phase 2)
- **Tick-based game loop** — planned for Phase 2 (`setInterval` inside the DO, default 20 ticks/sec)
- **Server-authoritative** — clients send only `join` (Phase 1) and `input` direction (Phase 2); server computes all state
- **No persistent storage** — scores reset each round, no leaderboard

## Key Specs

- Full feature spec: `docs/specs/feature-list.md`
- Config defaults defined in YAML: `maxPlayers: 10`, `pacmanCount: 1`, `tickRate: 20`, etc.
- Client protocol: implemented — 3 server types (`welcome`, `lobby`, `error`), 1 client type (`join`); planned — `round_start`, `state`, `round_end` server types, `input` client type
- Server lifecycle: currently accepts connections directly; planned — stopped → running (via admin API) → lobby → round → lobby
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
│   ├── game-room.ts      # GameRoom Durable Object (lobby, WebSocket handling)
│   └── types.ts          # Shared type definitions (Env, Player, messages)
└── test/
    ├── tsconfig.json      # Test-specific TS config
    ├── env.d.ts           # cloudflare:test type declarations
    └── game-room.test.ts  # Phase 1 tests (18 tests)
```

## Build Commands

- `npm test` — run all tests (Vitest + @cloudflare/vitest-pool-workers)
- `npm run test:watch` — run tests in watch mode
- `npm run dev` — start local dev server (wrangler dev, port 8000)
- `npm run deploy` — deploy to Cloudflare
