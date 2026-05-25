import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAIApiError } from "./openai/errors.ts";

const agentCwd = join(tmpdir(), "cursor-sdk-server");
mkdirSync(agentCwd, { recursive: true });

export const config = {
  port: Number(Bun.env.PORT ?? 8765),
  host: Bun.env.HOST ?? "0.0.0.0",
  cursorApiKey: Bun.env.CURSOR_API_KEY ?? "",
  agentCwd,
};

export function requireCursorApiKey(): string {
  const apiKey = config.cursorApiKey.trim();
  if (!apiKey) {
    throw new OpenAIApiError(
      500,
      "CURSOR_API_KEY is required on the server.",
      "server_configuration_error",
    );
  }
  return apiKey;
}
