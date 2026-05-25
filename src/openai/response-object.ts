import type {
  CreateResponseRequest,
  OpenAIResponse,
  ResponseOutputItem,
  ResponseUsage,
} from "./types.ts";
import { createResponseId } from "./ids.ts";
import { extractOutputText } from "./errors.ts";

export function createBaseResponse(
  body: CreateResponseRequest,
  overrides: Partial<OpenAIResponse> = {},
): OpenAIResponse {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: createResponseId(),
    object: "response",
    created_at: now,
    status: "in_progress",
    model: body.model,
    output: [],
    metadata: body.metadata,
    previous_response_id: body.previous_response_id ?? undefined,
    instructions: body.instructions ?? null,
    tools: body.tools,
    parallel_tool_calls: body.parallel_tool_calls,
    temperature: body.temperature,
    top_p: body.top_p,
    max_output_tokens: body.max_output_tokens ?? null,
    reasoning: body.reasoning,
    text: body.text,
    store: body.store ?? true,
    service_tier: body.service_tier,
    ...overrides,
  };
}

export function createMessageItem(text = ""): Extract<ResponseOutputItem, { type: "message" }> {
  return {
    type: "message",
    id: `msg_${Date.now()}`,
    role: "assistant",
    status: "in_progress",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

export function createReasoningItem(
  itemId: string,
): Extract<ResponseOutputItem, { type: "reasoning" }> {
  return {
    type: "reasoning",
    id: itemId,
    summary: [{ type: "summary_text", text: "" }],
    content: [],
  };
}

export function finalizeResponse(
  response: OpenAIResponse,
  status: OpenAIResponse["status"],
  usage?: ResponseUsage,
  error?: OpenAIResponse["error"],
): OpenAIResponse {
  return {
    ...response,
    status,
    usage,
    error,
    output_text: extractOutputText(response),
  };
}

function estimateTextTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function estimateContentTokens(content: unknown): number {
  if (typeof content === "string") return estimateTextTokens(content);
  if (!Array.isArray(content)) return 0;

  return content.reduce((total, part) => {
    if (!part || typeof part !== "object") return total;
    const record = part as Record<string, unknown>;
    if (
      (record.type === "input_text" || record.type === "output_text") &&
      typeof record.text === "string"
    ) {
      return total + estimateTextTokens(record.text);
    }
    if (record.type === "input_file" && typeof record.filename === "string") {
      return total + estimateTextTokens(record.filename);
    }
    return total;
  }, 0);
}

export function estimateClientInputTokens(body: CreateResponseRequest): number {
  let total = estimateTextTokens(body.instructions ?? "");
  if (typeof body.input === "string") return total + estimateTextTokens(body.input);
  if (!Array.isArray(body.input)) return total;

  for (const item of body.input) {
    if (item.type === "function_call") {
      total += estimateTextTokens(item.name) + estimateTextTokens(item.arguments);
      continue;
    }
    if (item.type === "function_call_output") {
      total += estimateTextTokens(item.call_id) + estimateContentTokens(item.output);
      continue;
    }
    if (item.type === "message") {
      total += estimateContentTokens(item.content);
    }
  }

  return total;
}

// Cursor SDK input/cache tokens include hidden agent context; expose only client-visible usage.
export function usageFromTurnEnded(
  body: CreateResponseRequest,
  usage?: Pick<{ outputTokens: number }, "outputTokens">,
): ResponseUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = estimateClientInputTokens(body);
  const { outputTokens } = usage;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}
