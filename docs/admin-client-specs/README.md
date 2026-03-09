# Admin Client Developer Guide

Build an admin tool to manage the Pacman game server. The admin API is a standard HTTP REST API with Bearer token authentication.

## Overview

The admin API lets you:
- Start and stop the server
- Start and stop game rounds
- View server status, players, and config
- Change game configuration at runtime

## Documentation

| File | Contents |
|------|----------|
| [api-reference.md](api-reference.md) | Complete HTTP API — all endpoints, request/response schemas, error codes |
| [server-lifecycle.md](server-lifecycle.md) | Server states, transitions, and operational workflows |
| [configuration.md](configuration.md) | All config parameters, defaults, validation rules, and when changes apply |

## Quick Start

All requests require the `Authorization` header:

```
Authorization: Bearer <ADMIN_API_KEY>
```

```bash
# Start the server
curl -X POST https://<server-host>/admin/server/start \
  -H "Authorization: Bearer <key>"

# Check status
curl https://<server-host>/admin/status \
  -H "Authorization: Bearer <key>"

# Start a round (needs 2+ players in lobby)
curl -X POST https://<server-host>/admin/round/start \
  -H "Authorization: Bearer <key>"

# Stop the round
curl -X POST https://<server-host>/admin/round/stop \
  -H "Authorization: Bearer <key>"

# Stop the server
curl -X POST https://<server-host>/admin/server/stop \
  -H "Authorization: Bearer <key>"
```
