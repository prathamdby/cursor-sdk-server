# cursor-sdk-server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Unofficial [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) HTTP server backed by the [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript) (`@cursor/sdk`). Run it locally, point clients at its `baseURL`, and execute Cursor agents as an OpenAI-compatible model endpoint.

**Repository:** [github.com/prathamdby/cursor-sdk-server](https://github.com/prathamdby/cursor-sdk-server)  
**Maintainer:** [Pratham Dubey](https://github.com/prathamdby)  
**License:** MIT — see [LICENSE](LICENSE)

> This project is not affiliated with or endorsed by Cursor. It is a community adapter (“server + protocol shim”), not the official SDK package.

## Why this exists

Tools like [Pi](https://github.com/earendil-works/pi) speak the OpenAI **Responses** protocol (`openai-responses` API). Cursor exposes agents through `@cursor/sdk`, not through that HTTP shape. **cursor-sdk-server** sits in the middle: OpenAI request/response on the wire, Cursor agent runs on the backend.

## Features

- **Responses API** — `POST /v1/responses` (sync + SSE), `GET /v1/responses/:id`, `POST /v1/responses/:id/cancel`, `GET /v1/models`, `GET /health`
- **Local Cursor agents** — `Agent.create` / `Agent.resume`, streaming, cancellation
- **Model aliases** — `composer-2.5-fast`, `composer-2.5-quality`, etc.
- **Multi-turn** — `previous_response_id` maps to the same Cursor agent
- **Pi-friendly input** — message items with or without `type: "message"`
- **Images over HTTP** — `input_image` data URLs materialized to temp files for the agent
- **Private by default** — not published to npm; clone and run from source

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

| Variable | Default | Description |
| --- | --- | --- |
| `CURSOR_API_KEY` | *(required)* | Server-side Cursor API key |
| `PORT` | `8765` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |

Use `bun --env-file=.env` for `dev`, `start`, and tests.

**Agent workspace:** `/tmp/cursor-sdk-server` (created at startup, not configurable).  
**Client auth:** `Authorization` headers from clients are ignored.

## API summary

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/responses` | Create response (`stream: true` for SSE) |
| `GET` | `/v1/responses/:id` | Retrieve stored response |
| `POST` | `/v1/responses/:id/cancel` | Cancel in-flight run |
| `GET` | `/v1/models` | List models + aliases |
| `GET` | `/health` | Health check |

Output format: plain text only (`text.format.type` must be `text` if set). Many OpenAI parameters are intentionally unsupported — see [Limitations](#limitations).

## Model aliases

| Request `model` | Cursor backend |
| --- | --- |
| `composer-2.5` | `composer-2.5` |
| `composer-2.5-fast` | `composer-2.5` + `fast=true` |
| `composer-2.5-quality` | `composer-2.5` + `fast=false` |

Other Cursor models with a `fast` parameter get the same `-fast` / `-quality` suffix pattern.

## Pi setup

Add to `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "cursor": {
      "baseUrl": "http://127.0.0.1:8765/v1",
      "api": "openai-responses",
      "apiKey": "unused",
      "models": [
        {
          "id": "composer-2.5-fast",
          "name": "Composer 2.5 Fast",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 200000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

Pi requires `apiKey`; this server ignores it and uses `CURSOR_API_KEY` from its own environment.

## Limitations

- Not full OpenAI Responses parity (no request `tools[]` loop, no `background`, etc.)
- No `/v1/chat/completions`
- In-memory response store (lost on restart)
- Agent workspace is `/tmp/cursor-sdk-server`, not your repo cwd
- Long-running agent tasks can take minutes; streaming buffers final text and sends keepalives
- `temperature` / `top_p` are not forwarded to Cursor yet

## Development

```bash
bun run dev
bun run start
bun run check:code    # typecheck + oxlint + oxfmt
bun run lint:fix
bun run fmt
```

**Tests** (HTTP smokes need a running server):

```bash
bun --env-file=.env run test/input-prompt.test.ts
bun --env-file=.env run test/model-aliases.test.ts
bun --env-file=.env run test/compliance-smoke.ts
bun --env-file=.env run test/image-api-smoke.ts
```

## Architecture

```text
Client (Pi, OpenAI SDK, curl)
  → Elysia HTTP (/v1/responses)
  → validate + map to Cursor prompt
  → @cursor/sdk local agent (/tmp/cursor-sdk-server)
  → map deltas → OpenAI response / SSE
```

## Publishing

This package is **`private: true`** and is not intended for npm publication. Install from source via git.

## License

MIT © 2026 Pratham Dubey — see [LICENSE](LICENSE).
