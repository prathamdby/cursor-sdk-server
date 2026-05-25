import { Elysia } from "elysia";
import { assertCreateBody } from "../openai/errors.ts";
import { parseCreateResponseBody } from "../openai/validate.ts";
import { createSseStream } from "../openai/stream.ts";
import { runResponseStream, runResponseSync } from "../cursor/run-response.ts";
import type { RunOptions } from "../cursor/run-response.ts";
import {
  deleteStoredResponse,
  getStoredResponse,
  resolveAgentId,
  storeResponse,
} from "../store/responses.ts";
import { config, requireCursorApiKey } from "../config.ts";

export const responsesRoutes = new Elysia({ prefix: "/v1" })
  .post(
    "/responses",
    async ({ body, request, set }) => {
      assertCreateBody(body);
      const createBody = parseCreateResponseBody(body);
      const apiKey = requireCursorApiKey();

      const previousAgentId = resolveAgentId(createBody.previous_response_id ?? undefined);
      const runOptions: RunOptions = {
        apiKey,
        cwd: config.agentCwd,
        body: createBody,
        previousAgentId,
        signal: request.signal,
        onResponseCreated: (response) => {
          storeResponse(response.id, { response });
        },
        onRunStarted: ({ response, agentId, abort }) => {
          storeResponse(response.id, { response, agentId, abort });
        },
        onResponseUpdated: (response) => {
          if (createBody.store === false) {
            deleteStoredResponse(response.id);
          } else {
            const current = getStoredResponse(response.id);
            storeResponse(response.id, { ...current, response });
          }
        },
      };

      if (createBody.stream) {
        set.headers["content-type"] = "text/event-stream; charset=utf-8";
        set.headers["cache-control"] = "no-cache, no-transform";
        set.headers.connection = "keep-alive";
        set.headers["x-accel-buffering"] = "no";

        const stream = createSseStream(
          (async function* () {
            let terminalResponse;
            for await (const event of runResponseStream(runOptions)) {
              if (
                event.type === "response.completed" ||
                event.type === "response.failed" ||
                event.type === "response.cancelled"
              ) {
                terminalResponse = event.response;
              }
              yield event;
            }
            if (terminalResponse) {
              if (createBody.store === false) {
                deleteStoredResponse(terminalResponse.id);
              } else {
                const current = getStoredResponse(terminalResponse.id);
                storeResponse(terminalResponse.id, { ...current, response: terminalResponse });
              }
            }
          })(),
        );

        return new Response(stream);
      }

      const result = await runResponseSync(runOptions);
      if (createBody.store !== false) {
        storeResponse(result.response.id, {
          response: result.response,
          agentId: result.agentId,
          abort: result.abort,
        });
      }
      set.status = 200;
      return result.response;
    },
    {
      parse: "json",
    },
  )
  .get("/responses/:id", ({ params, set }) => {
    const stored = getStoredResponse(params.id);
    if (!stored) {
      set.status = 404;
      return {
        error: {
          message: `No response found with id '${params.id}'.`,
          type: "invalid_request_error",
          param: "id",
          code: null,
        },
      };
    }
    return stored.response;
  })
  .post("/responses/:id/cancel", async ({ params, set }) => {
    const stored = getStoredResponse(params.id);
    if (!stored) {
      set.status = 404;
      return {
        error: {
          message: `No response found with id '${params.id}'.`,
          type: "invalid_request_error",
          param: "id",
          code: null,
        },
      };
    }

    if (stored.abort) {
      await stored.abort().catch(() => undefined);
    }

    stored.response.status = "cancelled";
    return stored.response;
  });
