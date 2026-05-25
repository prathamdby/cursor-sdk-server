import { Agent, Cursor, type SDKAgent } from "@cursor/sdk";
import type {
  CreateResponseRequest,
  OpenAIResponse,
  ResponseStreamEvent,
} from "../openai/types.ts";
import { buildCursorPrompt, materializePromptImages } from "../openai/input.ts";
import { resolveCursorModel } from "./models.ts";
import { finalizeResponse } from "../openai/response-object.ts";
import { cancelledEvent, failedEvent, lifecycleEvents } from "../openai/stream.ts";
import { linkAgent } from "../store/responses.ts";
import { agentErrorMessage } from "./connect-errors.ts";
import { createEventQueue } from "./event-queue.ts";
import {
  canRecoverBenignStreamError,
  emitStreamCompletion,
  tryRecoverBenignStreamError,
} from "./stream-recovery.ts";
import {
  applyInteractionUpdate,
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
  /** When false, HTTP client abort does not cancel the Cursor run (streaming default). */
  cancelOnClientDisconnect?: boolean;
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

function wireClientAbort(run: { cancel: () => Promise<void> }, options: RunOptions): void {
  if (options.cancelOnClientDisconnect === false || !options.signal) return;
  options.signal.addEventListener(
    "abort",
    () => {
      void run.cancel().catch(() => undefined);
    },
    { once: true },
  );
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
      wireClientAbort(run, options);

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

    yield* emitStreamCompletion(state, result.result);
    options.onResponseUpdated?.(state.response);
  } catch (error) {
    if (canRecoverBenignStreamError(error, state)) {
      yield* tryRecoverBenignStreamError(error, state);
      options.onResponseUpdated?.(state.response);
      return;
    }

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
