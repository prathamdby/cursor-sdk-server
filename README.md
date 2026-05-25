# cursor-sdk-server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Unofficial [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) HTTP server backed by the [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript) (`@cursor/sdk`). Run it locally, point clients at its `baseURL`, and execute Cursor agents as an OpenAI-compatible model endpoint.

> This project is not affiliated with or endorsed by Cursor. It is a community adapter ("server + protocol shim"), not the official SDK package.

## Why this exists

Clients that speak the OpenAI **Responses** protocol (`openai-responses` API) need an HTTP endpoint Cursor does not provide natively. Cursor exposes agents through `@cursor/sdk`, not through that HTTP shape. **cursor-sdk-server** sits in the middle: OpenAI request/response on the wire, Cursor agent runs on the backend.

## Features

- **Responses API** — `POST /v1/responses` (sync + SSE), `GET /v1/responses/:id`, `POST /v1/responses/:id/cancel`, `GET /v1/models`, `GET /health`
- **Local Cursor agents** — `Agent.create` / `Agent.resume`, streaming, cancellation
- **Model aliases** — optional `-fast` suffix for fast-capable models
- **Multi-turn** — `previous_response_id` maps to the same Cursor agent
- **Flexible input** — message items with or without `type: "message"`
- **Images over HTTP** — `input_image` data URLs materialized to temp files for the agent

## Requirements

- [Bun](https://bun.sh) 1.1+
- [Cursor API key](https://cursor.com/dashboard/integrations)

## Quick start

```bash
git clone https://github.com/prathamdby/cursor-sdk-server.git
cd cursor-sdk-server
bun install
cp .env.example .env
# Set CURSOR_API_KEY in .env

bun --env-file=.env run dev
```

Default URL: `http://127.0.0.1:8765/v1`

**Try it:**

```bash
curl -s http://127.0.0.1:8765/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "composer-2.5-fast",
    "input": "Reply with exactly: hello from cursor-sdk-server",
    "stream": false
  }'
```

## Configuration

| Variable         | Default      | Description                |
| ---------------- | ------------ | -------------------------- |
| `CURSOR_API_KEY` | _(required)_ | Server-side Cursor API key |
| `PORT`           | `8765`       | Listen port                |
| `HOST`           | `0.0.0.0`    | Bind address               |

Use `bun --env-file=.env` for `dev`, `start`, and tests.

**Agent workspace:** `/tmp/cursor-sdk-server` (created at startup, not configurable).  
**Client auth:** `Authorization` headers from clients are ignored.

## API summary

| Method | Path                       | Description                              |
| ------ | -------------------------- | ---------------------------------------- |
| `POST` | `/v1/responses`            | Create response (`stream: true` for SSE) |
| `GET`  | `/v1/responses/:id`        | Retrieve stored response                 |
| `POST` | `/v1/responses/:id/cancel` | Cancel in-flight run                     |
| `GET`  | `/v1/models`               | List models + aliases                    |
| `GET`  | `/health`                  | Health check                             |

Output format: plain text only (`text.format.type` must be `text` if set). Many OpenAI parameters are intentionally unsupported — see [Limitations](#limitations).

## Limitations

- Not full OpenAI Responses parity (no request `tools[]` loop, no `background`, etc.)
- No `/v1/chat/completions`
- In-memory response store (lost on restart)

## Development

```bash
bun run dev
bun run start
bun run check:code    # typecheck + oxlint + oxfmt
bun run lint:fix
bun run fmt
```

## Architecture

```text
Client (OpenAI SDK, curl)
  → Elysia HTTP (/v1/responses)
  → validate + map to Cursor prompt
  → @cursor/sdk local agent (/tmp/cursor-sdk-server)
  → map deltas → OpenAI response / SSE
```

## Publishing

This package is **`private: true`** and is not intended for npm publication. Install from source via git.

## License

MIT © 2026 Pratham Dubey — see [LICENSE](LICENSE).
