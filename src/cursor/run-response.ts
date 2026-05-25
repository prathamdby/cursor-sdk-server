import { Agent, Cursor, type SDKAgent } from "@cursor/sdk";
import type {
  CreateResponseRequest,
  OpenAIResponse,
  ResponseStreamEvent,
} from "../openai/types.ts";
import { buildCursorPrompt, materializePromptImages } from "../openai/input.ts";
import { resolveCursorModel } from "./models.ts";
import { finalizeResponse } from "../openai/response-object.ts";
import { cancelledEvent, completedEvent, failedEvent, lifecycleEvents } from "../openai/stream.ts";
import { linkAgent } from "../store/responses.ts";
import { agentErrorMessage } from "./connect-errors.ts";
import {
  applyInteractionUpdate,
  buildAssistantTextEvents,
  createStreamMappingState,
  finalizeItems,
  resolveFinalAssistantText,
  setAssistantText,
} from "./stream-mapping.ts";

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

export async function runResponseSync(options: RunOptions): Promise<RunResult> {
  const state = createStreamMappingState(options.body);
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
        applyInteractionUpdate(update, state);
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
  const state = createStreamMappingState(options.body);
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
          eventQueue.push(applyInteractionUpdate(update, state));
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
