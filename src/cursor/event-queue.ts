import type { ResponseStreamEvent } from "../openai/types.ts";

/**
 * Bridges SDK onDelta callbacks into an async generator without losing wakeups
 * when pushes happen while the consumer is between drain and wait.
 */
export function createEventQueue() {
  const queue: ResponseStreamEvent[] = [];
  const waiters: Array<() => void> = [];

  const clearWaiters = () => {
    waiters.splice(0, waiters.length);
  };

  const notify = () => {
    const pending = waiters.splice(0, waiters.length);
    for (const resolve of pending) resolve();
  };

  const dequeueAll = function* (): Generator<ResponseStreamEvent> {
    while (queue.length > 0) {
      const event = queue.shift();
      if (event === undefined) break;
      yield event;
    }
  };

  return {
    push(events: ResponseStreamEvent[]) {
      if (events.length === 0) return;
      queue.push(...events);
      notify();
    },
    async *drainUntil(done: Promise<unknown>): AsyncGenerator<ResponseStreamEvent> {
      const donePromise = done.then(() => "done" as const);
      while (true) {
        yield* dequeueAll();

        const result = await Promise.race([
          donePromise,
          new Promise<"tick">((resolve) => {
            waiters.push(() => resolve("tick"));
          }),
        ]);

        if (result === "done") {
          clearWaiters();
          yield* dequeueAll();
          return;
        }
      }
    },
  };
}
