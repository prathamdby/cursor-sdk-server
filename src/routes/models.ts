import { Elysia } from "elysia";
import { listCursorModels } from "../cursor/run-response.ts";
import { listOpenAIModelIds } from "../cursor/models.ts";
import { requireCursorApiKey } from "../config.ts";

export const modelsRoutes = new Elysia({ prefix: "/v1" }).get("/models", async () => {
  const apiKey = requireCursorApiKey();
  const models = await listCursorModels(apiKey);
  const now = Math.floor(Date.now() / 1000);
  return {
    object: "list",
    data: listOpenAIModelIds(models).map((id) => ({
      id,
      object: "model",
      created: now,
      owned_by: "cursor",
    })),
  };
});
