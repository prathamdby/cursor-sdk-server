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

const queue = createEventQueue();
let resolveDone: () => void;
const done = new Promise<void>((resolve) => {
  resolveDone = resolve;
});

const events: ResponseStreamEvent[] = [];
const drain = (async () => {
  for await (const event of queue.drainUntil(done)) {
    events.push(event);
  }
})();

queue.push([deltaEvent("a")]);

await new Promise((resolve) => setTimeout(resolve, 5));
queue.push([deltaEvent("b")]);

const firstDeltaMs = await new Promise<number | null>((resolve) => {
  const start = Date.now();
  const check = () => {
    if (events.length > 0) return resolve(Date.now() - start);
    if (Date.now() - start > 50) return resolve(null);
    setTimeout(check, 1);
  };
  check();
});

resolveDone!();
await drain;

if (firstDeltaMs === null || firstDeltaMs > 40) {
  throw new Error(`first delta should arrive before run completes, got firstMs=${firstDeltaMs}`);
}

if (!events.some((event) => event.type === "response.output_text.delta" && event.delta === "a")) {
  throw new Error("missing first queued delta");
}

if (!events.some((event) => event.type === "response.output_text.delta" && event.delta === "b")) {
  throw new Error("missing second queued delta after wakeup race window");
}

console.log("event queue tests passed");
