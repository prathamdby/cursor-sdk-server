import { createEventQueue } from "../src/cursor/event-queue.ts";
import type { ResponseStreamEvent } from "../src/openai/types.ts";

function deltaEvent(text: string): ResponseStreamEvent {
  return {
    type: "response.output_text.delta",
    output_index: 0,
    content_index: 0,
    item_id: "msg_test",
    delta: text,
  };
}

async function collectTimedEvents(
  queue: ReturnType<typeof createEventQueue>,
  done: Promise<unknown>,
  maxMs: number,
): Promise<{ events: ResponseStreamEvent[]; firstMs: number | null }> {
  const events: ResponseStreamEvent[] = [];
  let firstMs: number | null = null;
  const start = Date.now();

  const drain = (async () => {
    for await (const event of queue.drainUntil(done)) {
      if (firstMs === null) firstMs = Date.now() - start;
      events.push(event);
    }
  })();

  await Promise.race([drain, new Promise((resolve) => setTimeout(resolve, maxMs))]);

  return { events, firstMs };
}

const queue = createEventQueue();
const done = new Promise<void>((resolve) => {
  setTimeout(resolve, 200);
});

const firstBatch = collectTimedEvents(queue, done, 50);
queue.push([deltaEvent("a")]);

setTimeout(() => {
  queue.push([deltaEvent("b")]);
}, 5);

const firstResult = await firstBatch;
const secondResult = await collectTimedEvents(queue, done, 200);

const allEvents = [...firstResult.events, ...secondResult.events];

if (firstResult.firstMs === null || firstResult.firstMs > 40) {
  throw new Error(
    `first delta should arrive before run completes, got firstMs=${firstResult.firstMs}`,
  );
}

if (
  !allEvents.some((event) => event.type === "response.output_text.delta" && event.delta === "a")
) {
  throw new Error("missing first queued delta");
}

if (
  !allEvents.some((event) => event.type === "response.output_text.delta" && event.delta === "b")
) {
  throw new Error("missing second queued delta after wakeup race window");
}

console.log("event queue tests passed");
