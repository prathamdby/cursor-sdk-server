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

// Cursor cacheReadTokens are internal SDK accounting; do not map them to OpenAI cached_tokens.
export function usageFromTurnEnded(
  usage?: Pick<{ inputTokens: number; outputTokens: number }, "inputTokens" | "outputTokens">,
): ResponseUsage | undefined {
  if (!usage) return undefined;
  const { inputTokens, outputTokens } = usage;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}
