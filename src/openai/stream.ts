import type {
  CreateResponseRequest,
  ResponseStreamEvent,
  OpenAIResponse,
  ResponseOutputItem,
} from "../openai/types.ts";

export function encodeSseEvent(
  event: ResponseStreamEvent | "[DONE]",
  sequenceNumber?: number,
): string {
  if (event === "[DONE]") return "data: [DONE]\n\n";
  const payload =
    sequenceNumber === undefined ? event : { ...event, sequence_number: sequenceNumber };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Proxies (Traefik/Dokploy) often ignore SSE comment lines for idle timeouts. */
const KEEPALIVE_MS = 10_000;

export function createSseHeartbeatEvent(responseId: string): ResponseStreamEvent {
  return {
    type: "response.in_progress",
    response: {
      id: responseId,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "in_progress",
      model: "",
      output: [],
    },
  };
}

export function createSseStream(
  events: AsyncIterable<ResponseStreamEvent>,
  getHeartbeatResponseId?: () => string | undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sequenceNumber = 0;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const keepalive = setInterval(() => {
        if (cancelled) return;
        try {
          const responseId = getHeartbeatResponseId?.();
          if (responseId) {
            controller.enqueue(encoder.encode(encodeSseEvent(createSseHeartbeatEvent(responseId))));
          } else {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }
        } catch {
          cancelled = true;
        }
      }, KEEPALIVE_MS);

      try {
        for await (const event of events) {
          if (cancelled) return;
          controller.enqueue(encoder.encode(encodeSseEvent(event, sequenceNumber++)));
        }
        if (cancelled) return;
        controller.enqueue(encoder.encode(encodeSseEvent("[DONE]")));
        controller.close();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(
            encodeSseEvent({
              type: "error",
              code: "server_error",
              message,
            }),
          ),
        );
        controller.enqueue(encoder.encode(encodeSseEvent("[DONE]")));
        controller.close();
      } finally {
        clearInterval(keepalive);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}

export interface StreamState {
  response: OpenAIResponse;
  body: CreateResponseRequest;
  outputIndex: number;
  messageItem?: Extract<ResponseOutputItem, { type: "message" }>;
  reasoningItem?: Extract<ResponseOutputItem, { type: "reasoning" }>;
  bufferedAssistantText: string;
}

export async function* lifecycleEvents(state: StreamState): AsyncGenerator<ResponseStreamEvent> {
  yield { type: "response.created", response: structuredClone(state.response) };
  yield { type: "response.in_progress", response: structuredClone(state.response) };
}

export async function* completedEvent(state: StreamState): AsyncGenerator<ResponseStreamEvent> {
  yield { type: "response.completed", response: structuredClone(state.response) };
}

export async function* cancelledEvent(
  state: StreamState,
  message = "Response cancelled",
): AsyncGenerator<ResponseStreamEvent> {
  state.response.status = "cancelled";
  state.response.error = { message, code: "cancelled" };
  yield { type: "response.cancelled", response: structuredClone(state.response) };
}

export async function* failedEvent(
  state: StreamState,
  message: string,
): AsyncGenerator<ResponseStreamEvent> {
  state.response.status = "failed";
  state.response.error = { message, code: "server_error" };
  yield { type: "response.failed", response: structuredClone(state.response) };
}
