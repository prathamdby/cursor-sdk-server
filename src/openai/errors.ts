import type { OpenAIResponse } from "./types.ts";

export class OpenAIApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly param?: string;

  constructor(status: number, message: string, code = "invalid_request_error", param?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.param = param;
  }

  toJson() {
    return {
      error: {
        message: this.message,
        type: this.code === "invalid_request_error" ? "invalid_request_error" : "server_error",
        param: this.param ?? null,
        code: this.code,
      },
    };
  }
}

export function assertCreateBody(body: unknown): asserts body is Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OpenAIApiError(400, "Invalid request body.", "invalid_request_error");
  }
}

export function requireModel(body: Record<string, unknown>): string {
  if (typeof body.model !== "string" || !body.model.trim()) {
    throw new OpenAIApiError(
      400,
      "Missing required parameter: 'model'.",
      "missing_required_parameter",
      "model",
    );
  }
  return body.model.trim();
}

export function extractOutputText(response: OpenAIResponse): string {
  const parts: string[] = [];
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type === "output_text") parts.push(part.text);
    }
  }
  return parts.join("");
}
