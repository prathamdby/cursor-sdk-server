import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { responsesRoutes } from "./routes/responses.ts";
import { modelsRoutes } from "./routes/models.ts";
import { OpenAIApiError } from "./openai/errors.ts";

export function createApp() {
  return new Elysia()
    .use(cors())
    .get("/health", () => ({ status: "ok" }))
    .use(responsesRoutes)
    .use(modelsRoutes)
    .onError(({ error, set }) => {
      if (error instanceof OpenAIApiError) {
        set.status = error.status;
        return error.toJson();
      }
      set.status = 500;
      return {
        error: {
          message: error instanceof Error ? error.message : "Internal server error",
          type: "server_error",
          code: "internal_error",
        },
      };
    });
}
