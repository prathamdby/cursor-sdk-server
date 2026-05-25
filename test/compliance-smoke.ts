const port = Number(Bun.env.PORT ?? 8765);
const baseUrl = `http://127.0.0.1:${port}`;

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
  };
}

async function request(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headers(),
      ...init?.headers,
    },
  });
}

async function expect(condition: unknown, message: string): Promise<void> {
  if (!condition) throw new Error(message);
}

async function readSse(response: Response): Promise<Array<Record<string, unknown> | "[DONE]">> {
  const text = await response.text();
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      if (!chunk.startsWith("data: ")) throw new Error(`bad SSE chunk: ${chunk}`);
      const payload = chunk.slice("data: ".length);
      return payload === "[DONE]" ? "[DONE]" : (JSON.parse(payload) as Record<string, unknown>);
    });
}

async function main() {
  const health = await fetch(`${baseUrl}/health`);
  await expect(health.ok, "health endpoint failed");

  const models = await request("/v1/models");
  await expect(models.ok, `models endpoint failed: ${models.status}`);
  const modelsBody = (await models.json()) as { object?: string; data?: Array<{ id?: string }> };
  await expect(modelsBody.object === "list", "models object mismatch");
  await expect(Array.isArray(modelsBody.data), "models data missing");

  const unsupportedBackground = await request("/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: "hello",
      background: true,
    }),
  });
  await expect(
    unsupportedBackground.status === 400,
    `background should be rejected, got ${unsupportedBackground.status}`,
  );

  const piReasoningShape = await request("/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
      stream: false,
      store: false,
      reasoning: { effort: "medium", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    }),
  });
  await expect(
    piReasoningShape.ok,
    `pi reasoning params should be accepted, got ${piReasoningShape.status}`,
  );

  const unsupportedJsonSchema = await request("/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: "hello",
      text: { format: { type: "json_schema", name: "x", schema: { type: "object" } } },
    }),
  });
  await expect(
    unsupportedJsonSchema.status === 400,
    `json_schema should be rejected, got ${unsupportedJsonSchema.status}`,
  );

  const sync = await request("/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: "Reply with exactly: cursor compliance ok",
      store: true,
    }),
  });
  await expect(sync.ok, `sync response failed: ${sync.status}`);
  const syncBody = (await sync.json()) as {
    id?: string;
    object?: string;
    status?: string;
    output_text?: string;
    output?: unknown[];
  };
  await expect(syncBody.object === "response", "sync object mismatch");
  await expect(syncBody.status === "completed", `sync status mismatch: ${syncBody.status}`);
  await expect(
    typeof syncBody.id === "string" && syncBody.id.startsWith("resp_"),
    "missing response id",
  );
  await expect(
    Array.isArray(syncBody.output) && syncBody.output.length > 0,
    "missing output items",
  );
  await expect(typeof syncBody.output_text === "string", "missing output_text");

  const retrieved = await request(`/v1/responses/${syncBody.id}`);
  await expect(retrieved.ok, `stored response lookup failed: ${retrieved.status}`);

  const noStore = await request("/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: [{ role: "user", content: "Reply with one word: ok" }],
      store: false,
    }),
  });
  await expect(noStore.ok, `store:false response failed: ${noStore.status}`);
  const noStoreBody = (await noStore.json()) as { id?: string };
  const noStoreLookup = await request(`/v1/responses/${noStoreBody.id}`);
  await expect(noStoreLookup.status === 404, `store:false response should not be retrievable`);

  const streamed = await request("/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: "Count from 1 to 3, no extra words.",
      stream: true,
    }),
  });
  await expect(streamed.ok, `stream response failed: ${streamed.status}`);
  await expect(
    streamed.headers.get("content-type")?.includes("text/event-stream"),
    "stream content-type mismatch",
  );

  const events = await readSse(streamed);
  await expect(events.at(-1) === "[DONE]", "stream missing [DONE]");
  const jsonEvents = events.filter((event): event is Record<string, unknown> => event !== "[DONE]");
  await expect(
    jsonEvents.some((event) => event.type === "response.created"),
    "missing response.created",
  );
  await expect(
    jsonEvents.some((event) => event.type === "response.output_text.delta"),
    "missing text delta",
  );
  await expect(
    jsonEvents.some((event) => event.type === "response.completed"),
    "missing response.completed",
  );

  const sequenceNumbers = jsonEvents.map((event) => event.sequence_number);
  await expect(
    sequenceNumbers.every((n) => typeof n === "number"),
    "missing sequence_number",
  );
  await expect(
    sequenceNumbers.every((n, i) => n === i),
    `sequence_number not monotonic: ${sequenceNumbers.join(",")}`,
  );

  const redPixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z4/EHwAFAgGAKr+1/wAAAABJRU5ErkJggg==";

  const imageResponse = await request("/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5-fast",
      store: false,
      stream: false,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "This image is a single solid color. Reply with exactly one word: the color name.",
            },
            { type: "input_image", image_url: redPixel, detail: "auto" },
          ],
        },
      ],
    }),
  });
  if (!imageResponse.ok) {
    throw new Error(`image response failed: ${imageResponse.status} ${await imageResponse.text()}`);
  }
  const imageBody = (await imageResponse.json()) as {
    status?: string;
    output_text?: string;
  };
  await expect(
    imageBody.status === "completed",
    `image response status mismatch: ${imageBody.status}`,
  );
  await expect(
    typeof imageBody.output_text === "string" && imageBody.output_text.length > 0,
    "image response missing text",
  );
  await expect(
    /red/i.test(imageBody.output_text ?? ""),
    `image response did not identify red pixel: ${imageBody.output_text}`,
  );

  console.log("compliance smoke passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
