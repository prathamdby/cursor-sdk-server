import type { InteractionUpdate } from "@cursor/sdk";
import type {
  CreateResponseRequest,
  OpenAIResponse,
  ResponseStreamEvent,
} from "../openai/types.ts";
import {
  createBaseResponse,
  createMessageItem,
  createReasoningItem,
  usageFromTurnEnded,
} from "../openai/response-object.ts";
import { createItemId } from "../openai/ids.ts";
import type { StreamState } from "../openai/stream.ts";

export function createStreamMappingState(body: CreateResponseRequest): StreamState {
  return {
    response: createBaseResponse(body),
    body,
    outputIndex: 0,
    bufferedAssistantText: "",
  };
}

export function suffixAfterPrefix(existing: string, incoming: string): string {
  if (!incoming) return "";
  if (!existing) return incoming;
  if (incoming.startsWith(existing)) return incoming.slice(existing.length);
  if (existing.startsWith(incoming)) return "";

  const trimmedExisting = existing.trim();
  const trimmedIncoming = incoming.trim();
  if (!trimmedExisting) return incoming;
  if (trimmedIncoming.startsWith(trimmedExisting)) {
    return trimmedIncoming.slice(trimmedExisting.length);
  }
  if (trimmedExisting.startsWith(trimmedIncoming)) return "";

  return "";
}

export function resolveFinalAssistantText(
  finalResult: string | undefined,
  buffered: string,
): string {
  const final = finalResult?.trim() ?? "";
  const streamed = buffered.trim();
  if (!final) return streamed;
  if (!streamed) return final;
  if (streamed.startsWith(final) && streamed.length > final.length) return streamed;
  if (final.startsWith(streamed) && final.length > streamed.length) return final;
  return final;
}

function ensureMessageItem(state: StreamState): {
  item: Extract<OpenAIResponse["output"][number], { type: "message" }>;
  events: ResponseStreamEvent[];
} {
  if (state.messageItem) {
    return { item: state.messageItem, events: [] };
  }
  const item = createMessageItem();
  item.id = createItemId("msg");
  state.messageItem = item;
  state.response.output.push(item);
  const outputIndex = state.outputIndex++;
  return {
    item,
    events: [
      {
        type: "response.output_item.added",
        output_index: outputIndex,
        item: { ...structuredClone(item), content: [] },
      },
      {
        type: "response.content_part.added",
        output_index: outputIndex,
        content_index: 0,
        item_id: item.id,
        part: { type: "output_text", text: "" },
      },
    ],
  };
}

function ensureReasoningItem(state: StreamState): {
  item: Extract<OpenAIResponse["output"][number], { type: "reasoning" }>;
  events: ResponseStreamEvent[];
} {
  if (state.reasoningItem) {
    return { item: state.reasoningItem, events: [] };
  }
  const item = createReasoningItem(createItemId("rs"));
  state.reasoningItem = item;
  state.response.output.push(item);
  const outputIndex = state.outputIndex++;
  return {
    item,
    events: [
      {
        type: "response.output_item.added",
        output_index: outputIndex,
        item: structuredClone(item),
      },
      {
        type: "response.reasoning_summary_part.added",
        output_index: outputIndex,
        item_id: item.id,
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      },
    ],
  };
}

function outputTextPart(item: Extract<OpenAIResponse["output"][number], { type: "message" }>) {
  const part = item.content[0];
  return part?.type === "output_text" ? part : undefined;
}

export function applyInteractionUpdate(
  update: InteractionUpdate,
  state: StreamState,
): ResponseStreamEvent[] {
  if (update.type === "text-delta" && update.text) {
    state.bufferedAssistantText += update.text;
    return buildAssistantTextEvents(state, state.bufferedAssistantText);
  }

  if (update.type === "thinking-delta" && update.text) {
    const { item, events } = ensureReasoningItem(state);
    const outputIndex = state.response.output.indexOf(item);
    item.summary ??= [{ type: "summary_text", text: "" }];
    item.summary[0].text += update.text;
    return [
      ...events,
      {
        type: "response.reasoning_summary_text.delta",
        output_index: outputIndex,
        item_id: item.id,
        summary_index: 0,
        delta: update.text,
      },
    ];
  }

  if (update.type === "turn-ended" && update.usage) {
    state.response.usage = usageFromTurnEnded(state.body, update.usage);
  }

  return [];
}

export function buildAssistantTextEvents(
  state: StreamState,
  text: string,
  chunkSize = 160,
): ResponseStreamEvent[] {
  if (!text) return [];

  const { item, events: startEvents } = ensureMessageItem(state);
  const part = outputTextPart(item);
  const existingText = part?.text ?? "";
  const textToEmit = suffixAfterPrefix(existingText, text);
  if (part) part.text = text;

  const outputIndex = state.response.output.indexOf(item);
  const events: ResponseStreamEvent[] = [...startEvents];

  for (let offset = 0; offset < textToEmit.length; offset += chunkSize) {
    events.push({
      type: "response.output_text.delta",
      output_index: outputIndex,
      content_index: 0,
      delta: textToEmit.slice(offset, offset + chunkSize),
      item_id: item.id,
    });
  }

  return events;
}

export function setAssistantText(state: StreamState, text: string): void {
  if (!text) return;
  const { item } = ensureMessageItem(state);
  const part = outputTextPart(item);
  if (part) part.text = text;
}

export function finalizeItems(state: StreamState): ResponseStreamEvent[] {
  const events: ResponseStreamEvent[] = [];

  if (state.messageItem) {
    const item = state.messageItem;
    item.status = "completed";
    const outputIndex = state.response.output.indexOf(item);
    events.push({
      type: "response.output_text.done",
      output_index: outputIndex,
      content_index: 0,
      text: outputTextPart(item)?.text ?? "",
      item_id: item.id,
    });
    events.push({
      type: "response.content_part.done",
      output_index: outputIndex,
      content_index: 0,
      item_id: item.id,
      part: { type: "output_text", text: outputTextPart(item)?.text ?? "" },
    });
    events.push({
      type: "response.output_item.done",
      output_index: outputIndex,
      item: structuredClone(item),
    });
  }

  if (state.reasoningItem) {
    const item = state.reasoningItem;
    const outputIndex = state.response.output.indexOf(item);
    const part = item.summary?.[0] ?? { type: "summary_text", text: "" };
    events.push({
      type: "response.reasoning_summary_part.done",
      output_index: outputIndex,
      item_id: item.id,
      summary_index: 0,
      part,
    });
    events.push({
      type: "response.output_item.done",
      output_index: outputIndex,
      item: structuredClone(item),
    });
  }

  return events;
}
