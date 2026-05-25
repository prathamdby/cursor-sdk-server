import { getTestBaseUrl } from "./helpers/env.ts";
import { assertOk } from "./helpers/assert.ts";

/**
 * E2E: server survives representative /v1/responses scenarios (including image + reasoning).
 * Requires running server: bun --env-file=.env run start
 */
const baseUrl = getTestBaseUrl();

const redPixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z4/EHwAFAgGAKr+1/wAAAABJRU5ErkJggg==";

type Step = { name: string; init: RequestInit; assert?: (detail: string) => void };

async function health(): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function runStep(
  step: Step,
  timeoutMs = 120_000,
): Promise<{ ok: boolean; status: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      ...step.init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...step.init.headers },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const done = text.includes("[DONE]");
      const failed = text.includes('"type":"response.failed"');
      return {
        ok: response.ok && done && !failed,
        status: response.status,
        detail: text,
      };
    }
    const text = await response.text();
    return { ok: response.ok, status: response.status, detail: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, detail: message };
  } finally {
    clearTimeout(timer);
  }
}

function parseSseEvents(text: string): Array<Record<string, unknown> | "[DONE]"> {
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => {
      const payload = chunk.slice("data: ".length);
      return payload === "[DONE]" ? "[DONE]" : (JSON.parse(payload) as Record<string, unknown>);
    });
}

const steps: Step[] = [
  {
    name: "sync-simple",
    init: {
      method: "POST",
      body: JSON.stringify({
        model: "composer-2.5-fast",
        input: "Reply with exactly: ok",
        stream: false,
        store: false,
      }),
    },
    assert(detail) {
      const body = JSON.parse(detail) as { status?: string; output_text?: string };
      assertOk(body.status === "completed", `sync-simple status: ${body.status}`);
      assertOk(body.output_text?.includes("ok"), `sync-simple text: ${body.output_text}`);
    },
  },
  {
    name: "stream-reasoning-dedup",
    init: {
      method: "POST",
      body: JSON.stringify({
        model: "composer-2.5",
        input: [
          { role: "user", content: [{ type: "input_text", text: "Say hello in one word." }] },
        ],
        stream: true,
        store: false,
        reasoning: { effort: "medium", summary: "auto" },
      }),
    },
    assert(detail) {
      const events = parseSseEvents(detail);
      const jsonEvents = events.filter(
        (event): event is Record<string, unknown> => event !== "[DONE]",
      );
      const summaryDeltas = jsonEvents.filter(
        (event) => event.type === "response.reasoning_summary_text.delta",
      );
      const reasoningTextDeltas = jsonEvents.filter(
        (event) => event.type === "response.reasoning_text.delta",
      );
      if (summaryDeltas.length > 0) {
        assertOk(
          reasoningTextDeltas.length === 0,
          "reasoning stream must not emit reasoning_text.delta alongside summary deltas",
        );
      }
      assertOk(
        jsonEvents.some((event) => event.type === "response.completed"),
        "stream-reasoning-dedup missing response.completed",
      );
    },
  },
  {
    name: "sync-image",
    init: {
      method: "POST",
      body: JSON.stringify({
        model: "composer-2.5-fast",
        store: false,
        stream: false,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "One word color name only." },
              { type: "input_image", image_url: redPixel, detail: "auto" },
            ],
          },
        ],
      }),
    },
    assert(detail) {
      const body = JSON.parse(detail) as { status?: string; output_text?: string };
      if (body.status !== "completed") {
        console.warn(
          `sync-image returned status=${body.status}; server survival is the primary check`,
        );
        return;
      }
      assertOk(/red/i.test(body.output_text ?? ""), `sync-image text: ${body.output_text}`);
    },
  },
];

async function runServerSurvivalE2e() {
  assertOk(await health(), "server not healthy at start");

  for (const step of steps) {
    console.log(`\n--- ${step.name} ---`);
    const timeoutMs = step.name === "sync-image" ? 90_000 : 120_000;
    const result = await runStep(step, timeoutMs);

    if (!result.ok && step.name === "sync-image") {
      console.warn(
        `sync-image request incomplete: status=${result.status} ${result.detail.slice(0, 120)}`,
      );
    } else {
      assertOk(
        result.ok,
        `${step.name} request failed: status=${result.status} ${result.detail.slice(0, 200)}`,
      );
      step.assert?.(result.detail);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    assertOk(await health(), `server died after step "${step.name}"`);
    console.log(`${step.name}: ok`);
  }

  console.log("\nserver survival e2e passed");
}

runServerSurvivalE2e().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
