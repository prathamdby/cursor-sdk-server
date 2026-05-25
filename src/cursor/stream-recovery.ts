import type { ResponseStreamEvent } from "../openai/types.ts";
import { finalizeResponse } from "../openai/response-object.ts";
import { completedEvent } from "../openai/stream.ts";
import type { StreamState } from "../openai/stream.ts";
import { isBenignConnectrpcStreamError } from "./connect-errors.ts";
import {
  buildAssistantTextEvents,
  finalizeItems,
  resolveFinalAssistantText,
} from "./stream-mapping.ts";

export function hasPartialStreamContent(state: StreamState): boolean {
  return Boolean(
    state.bufferedAssistantText.trim() ||
    state.messageItem ||
    state.reasoningItem ||
    state.response.output.length > 0,
  );
}

export function canRecoverBenignStreamError(error: unknown, state: StreamState): boolean {
  return isBenignConnectrpcStreamError(error) && hasPartialStreamContent(state);
}

export async function* emitStreamCompletion(
  state: StreamState,
  finalResult: string | undefined,
): AsyncGenerator<ResponseStreamEvent> {
  const finalText = resolveFinalAssistantText(finalResult, state.bufferedAssistantText);
  for (const event of buildAssistantTextEvents(state, finalText)) {
    yield event;
  }
  for (const event of finalizeItems(state)) {
    yield event;
  }
  state.response = finalizeResponse(state.response, "completed", state.response.usage);
  yield* completedEvent(state);
}

export async function* tryRecoverBenignStreamError(
  error: unknown,
  state: StreamState,
): AsyncGenerator<ResponseStreamEvent> {
  if (!canRecoverBenignStreamError(error, state)) return;
  yield* emitStreamCompletion(state, state.bufferedAssistantText);
}
