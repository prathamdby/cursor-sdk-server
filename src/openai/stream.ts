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

/** Idle timeout for reverse proxies; override with SSE_KEEPALIVE_MS. */
export const SSE_KEEPALIVE_MS = Number(Bun.env.SSE_KEEPALIVE_MS ?? 10_000);

export interface SseStreamOptions {
  /** Full response snapshot for proxy keepalives (avoids stub lifecycle events). */
  getHeartbeatSnapshot?: () => OpenAIResponse | undefined;
  /** Called when the HTTP client closes the SSE connection. */
  onClientDisconnect?: () => void;
}

export function encodeSseKeepaliveChunk(snapshot?: OpenAIResponse): string {
  if (snapshot) {
    return encodeSseEvent({
      type: "response.in_progress",
      response: structuredClone(snapshot),
    });
  }
  return ": keepalive\n\n";
}

export function createSseStream(
  events: AsyncIterable<ResponseStreamEvent>,
  options?: SseStreamOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sequenceNumber = 0;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const keepalive = setInterval(() => {
        if (cancelled) return;
        try {
          const snapshot = options?.getHeartbeatSnapshot?.();
          controller.enqueue(encoder.encode(encodeSseKeepaliveChunk(snapshot)));
        } catch {
          cancelled = true;
        }
      }, SSE_KEEPALIVE_MS);

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
      options?.onClientDisconnect?.();
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
