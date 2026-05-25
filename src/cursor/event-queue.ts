import type { ResponseStreamEvent } from "../openai/types.ts";

/**
 * Bridges SDK onDelta callbacks into an async generator without losing wakeups
 * when pushes happen while the consumer is between drain and wait.
 */
export function createEventQueue() {
  const queue: ResponseStreamEvent[] = [];
  const waiters: Array<() => void> = [];

  const notify = () => {
    const pending = waiters.splice(0, waiters.length);
    for (const resolve of pending) resolve();
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
        while (queue.length > 0) {
          yield queue.shift()!;
        }

        const result = await Promise.race([
          donePromise,
          new Promise<"tick">((resolve) => {
            waiters.push(() => resolve("tick"));
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
