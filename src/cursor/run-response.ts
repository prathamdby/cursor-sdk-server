import { Agent, Cursor, type InteractionUpdate, type SDKAgent } from "@cursor/sdk";
import type {
  CreateResponseRequest,
  OpenAIResponse,
  ResponseStreamEvent,
} from "../openai/types.ts";
import { buildCursorPrompt, materializePromptImages } from "../openai/input.ts";
import { resolveCursorModel } from "./models.ts";
import {
  createBaseResponse,
  createMessageItem,
  createReasoningItem,
  finalizeResponse,
  usageFromTurnEnded,
} from "../openai/response-object.ts";
import { createItemId } from "../openai/ids.ts";
import {
  cancelledEvent,
  completedEvent,
  failedEvent,
  lifecycleEvents,
  type StreamState,
} from "../openai/stream.ts";
import { linkAgent } from "../store/responses.ts";
import { agentErrorMessage } from "./connect-errors.ts";

export interface RunOptions {
  apiKey: string;
  cwd: string;
  body: CreateResponseRequest;
  previousAgentId?: string;
  signal?: AbortSignal;
  onResponseCreated?: (response: OpenAIResponse) => void;
  onRunStarted?: (args: {
    response: OpenAIResponse;
    agentId: string;
    abort: () => Promise<void>;
  }) => void;
  onResponseUpdated?: (response: OpenAIResponse) => void;
}

export interface RunResult {
  response: OpenAIResponse;
  agentId: string;
  abort: () => Promise<void>;
}

const noopAbort = async (): Promise<void> => {};

function createStreamState(body: CreateResponseRequest): StreamState {
  return {
    response: createBaseResponse(body),
    outputIndex: 0,
    bufferedAssistantText: "",
  };
}

function createEventQueue() {
  const queue: ResponseStreamEvent[] = [];
  let wake: (() => void) | null = null;

  return {
    push(events: ResponseStreamEvent[]) {
      if (events.length === 0) return;
      queue.push(...events);
      wake?.();
      wake = null;
    },
    async *drainUntil(done: Promise<unknown>): AsyncGenerator<ResponseStreamEvent> {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }

        const result = await Promise.race([
          done.then(() => "done" as const),
          new Promise<"tick">((resolve) => {
            wake = () => resolve("tick");
          }),
        ]);

        if (result === "done") {
          while (queue.length > 0) {
            yield queue.shift()!;
          }
          return;
        }
      }
    },
  };
}

async function openAgent(options: RunOptions): Promise<SDKAgent> {
  const model = resolveCursorModel(options.body.model, options.body.reasoning);

  if (options.previousAgentId) {
    return Agent.resume(options.previousAgentId, {
      apiKey: options.apiKey,
      model,
      local: { cwd: options.cwd, settingSources: [] },
    });
  }

  return Agent.create({
    apiKey: options.apiKey,
    model,
    local: { cwd: options.cwd, settingSources: [] },
  });
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

export function resolveFinalAssistantText(
  finalResult: string | undefined,
  buffered: string,
): string {
  const final = finalResult?.trim() ?? "";
  const streamed = buffered.trim();
  if (!final) return streamed;
  if (!streamed) return final;
  if (streamed.length > final.length) return streamed;
  return final;
}

function applyDelta(update: InteractionUpdate, state: StreamState): ResponseStreamEvent[] {
  if (update.type === "text-delta" && update.text) {
    state.bufferedAssistantText += update.text;
    return [];
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
    state.response.usage = usageFromTurnEnded(update.usage);
  }

  return [];
}

function buildAssistantTextEvents(
  state: StreamState,
  text: string,
  chunkSize = 160,
): ResponseStreamEvent[] {
  if (!text) return [];

  const { item, events: startEvents } = ensureMessageItem(state);
  const part = outputTextPart(item);
  if (part) part.text = text;

  const outputIndex = state.response.output.indexOf(item);
  const events: ResponseStreamEvent[] = [...startEvents];

  for (let offset = 0; offset < text.length; offset += chunkSize) {
    events.push({
      type: "response.output_text.delta",
      output_index: outputIndex,
      content_index: 0,
      delta: text.slice(offset, offset + chunkSize),
      item_id: item.id,
    });
  }

  return events;
}

function setAssistantText(state: StreamState, text: string): void {
  if (!text) return;
  const { item } = ensureMessageItem(state);
  const part = outputTextPart(item);
  if (part) part.text = text;
}

function finalizeItems(state: StreamState): ResponseStreamEvent[] {
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

export async function runResponseSync(options: RunOptions): Promise<RunResult> {
  const state = createStreamState(options.body);
  options.onResponseCreated?.(state.response);

  let agent: SDKAgent | undefined;
  let agentId = "";
  let abort = noopAbort;

  try {
    agent = await openAgent(options);
    agentId = agent.agentId;
    linkAgent(state.response.id, agentId);

    const prompt = materializePromptImages(buildCursorPrompt(options.body));
    const run = await agent.send(prompt, {
      onDelta: ({ update }) => {
        try {
          applyDelta(update, state);
        } catch {
          // Ignore malformed delta payloads from the SDK stream.
        }
      },
    });

    abort = () => run.cancel();
    options.onRunStarted?.({ response: state.response, agentId, abort });

    const result = await run.wait();

    if (result.status === "cancelled") {
      state.response = finalizeResponse(state.response, "cancelled", state.response.usage, {
        message: "Response cancelled",
        code: "cancelled",
      });
      options.onResponseUpdated?.(state.response);
      return { response: state.response, agentId, abort };
    }

    if (result.status === "error") {
      state.response = finalizeResponse(state.response, "failed", state.response.usage, {
        message: "Cursor agent run failed",
        code: "server_error",
      });
      options.onResponseUpdated?.(state.response);
      return { response: state.response, agentId, abort };
    }

    setAssistantText(state, resolveFinalAssistantText(result.result, state.bufferedAssistantText));
    finalizeItems(state);
    state.response = finalizeResponse(state.response, "completed", state.response.usage);
    options.onResponseUpdated?.(state.response);
    return { response: state.response, agentId, abort };
  } catch (error) {
    state.response = finalizeResponse(state.response, "failed", state.response.usage, {
      message: agentErrorMessage(error),
      code: "server_error",
    });
    options.onResponseUpdated?.(state.response);
    return { response: state.response, agentId, abort };
  } finally {
    if (agent) {
      await agent[Symbol.asyncDispose]().catch(() => undefined);
    }
  }
}

export async function* runResponseStream(options: RunOptions): AsyncGenerator<ResponseStreamEvent> {
  const state = createStreamState(options.body);
  options.onResponseCreated?.(state.response);

  yield* lifecycleEvents(state);

  let agent: SDKAgent | undefined;

  try {
    agent = await openAgent(options);
    linkAgent(state.response.id, agent.agentId);

    const prompt = materializePromptImages(buildCursorPrompt(options.body));
    const eventQueue = createEventQueue();

    const runTask = (async () => {
      const run = await agent.send(prompt, {
        onDelta: ({ update }) => {
          try {
            eventQueue.push(applyDelta(update, state));
          } catch {
            // Ignore malformed delta payloads from the SDK stream.
          }
        },
      });

      const abort = () => run.cancel();
      options.onRunStarted?.({ response: state.response, agentId: agent.agentId, abort });
      options.signal?.addEventListener(
        "abort",
        () => {
          void run.cancel().catch(() => undefined);
        },
        { once: true },
      );

      return run.wait();
    })();

    for await (const event of eventQueue.drainUntil(runTask)) {
      yield event;
    }

    const result = await runTask;

    if (result.status === "cancelled") {
      state.response = finalizeResponse(state.response, "cancelled", state.response.usage, {
        message: "Response cancelled",
        code: "cancelled",
      });
      options.onResponseUpdated?.(state.response);
      yield* cancelledEvent(state);
      return;
    }
    if (result.status === "error") {
      state.response = finalizeResponse(state.response, "failed", state.response.usage, {
        message: "Cursor agent run failed",
        code: "server_error",
      });
      options.onResponseUpdated?.(state.response);
      yield* failedEvent(state, "Cursor agent run failed");
      return;
    }

    const finalText = resolveFinalAssistantText(result.result, state.bufferedAssistantText);
    for (const event of buildAssistantTextEvents(state, finalText)) {
      yield event;
    }

    for (const event of finalizeItems(state)) {
      yield event;
    }

    state.response = finalizeResponse(state.response, "completed", state.response.usage);
    options.onResponseUpdated?.(state.response);
    yield* completedEvent(state);
  } catch (error) {
    const message = agentErrorMessage(error);
    state.response = finalizeResponse(state.response, "failed", state.response.usage, {
      message,
      code: "server_error",
    });
    options.onResponseUpdated?.(state.response);
    yield* failedEvent(state, message);
  } finally {
    if (agent) {
      await agent[Symbol.asyncDispose]().catch(() => undefined);
    }
  }
}

export async function listCursorModels(apiKey: string) {
  return Cursor.models.list({ apiKey });
}

/** @internal test helpers */
export function createStreamStateForTest(body: CreateResponseRequest): StreamState {
  return createStreamState(body);
}

/** @internal test helpers */
export function applyInteractionUpdateForTest(
  update: InteractionUpdate,
  state: StreamState,
): ResponseStreamEvent[] {
  return applyDelta(update, state);
}
