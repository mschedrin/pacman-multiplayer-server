# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multiplayer Pacman game server for hackathons. Server-authoritative, built on Cloudflare Workers + Durable Objects. Participants build their own clients in 3 hours; the server handles all game logic.

**Status:** Planning/infrastructure phase — spec is complete, implementation has not started.

## Architecture

- **Cloudflare Worker** — HTTP entrypoint at `GET /ws` (WebSocket upgrade) and `/admin/*` (REST API with Bearer token auth)
- **Single Durable Object** — holds all state: lobby, players, game loop, round lifecycle
- **Tick-based game loop** — `setInterval` inside the Durable Object, default 20 ticks/sec
- **Server-authoritative** — clients send only `join` and `input` (direction), server computes movement, collisions, scoring, and broadcasts full state every tick
- **No persistent storage** — scores reset each round, no leaderboard

## Key Specs

- Full feature spec: `docs/specs/feature-list.md`
- Config defaults defined in YAML: `maxPlayers: 10`, `pacmanCount: 1`, `tickRate: 20`, etc.
- Client protocol: 6 server message types (`welcome`, `lobby`, `round_start`, `state`, `round_end`, `error`), 2 client message types (`join`, `input`)
- Server lifecycle: stopped → running (via admin API) → lobby → round → lobby (repeat)
- Auto-shutdown via Cloudflare Alarm API after 3 hours with 0 players

## Development Environment

- Devcontainer with Ubuntu 24.04, Node.js 22 LTS, Fish shell
- Port 8000 forwarded for local dev
- `./dev` script opens a Fish shell in the running devcontainer
- Wrangler CLI available for Cloudflare Workers development
- Use `/durable-objects`, `/wrangler`, `/cloudflare`, and `/workers-best-practices` skills when implementing Cloudflare-specific code

## Build Commands

No build/test/lint commands yet — implementation has not started. When implementation begins, expect a standard Wrangler-based workflow:
- `npx wrangler dev` — local development server
- `npx wrangler deploy` — deploy to Cloudflare
