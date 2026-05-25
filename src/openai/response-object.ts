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

export function usageFromTurnEnded(usage?: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}): ResponseUsage | undefined {
  if (!usage) return undefined;
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    input_tokens_details: usage.cacheReadTokens
      ? { cached_tokens: usage.cacheReadTokens }
      : undefined,
  };
}
