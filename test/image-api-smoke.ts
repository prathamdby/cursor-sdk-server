import { readFileSync } from "node:fs";
import { getTestBaseUrl } from "./helpers/env.ts";

const baseUrl = getTestBaseUrl();

const defaultImageUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z4/EHwAFAgGAKr+1/wAAAABJRU5ErkJggg==";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function resolveImageUrl(): { imageUrl: string; label: string } {
  const imagePath = process.argv[2];
  if (!imagePath) {
    return { imageUrl: defaultImageUrl, label: "built-in 1x1 red pixel fixture" };
  }

  const bytes = readFileSync(imagePath);
  const mime = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  return {
    imageUrl: `data:${mime};base64,${bytes.toString("base64")}`,
    label: `${imagePath} (${bytes.length} bytes)`,
  };
}

async function main() {
  const { imageUrl, label } = resolveImageUrl();

  console.log(`image: ${label}`);
  console.log(`POST ${baseUrl}/v1/responses (input_image data URL)`);

  const started = Date.now();
  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
              text: "Describe what you see in the attached image in 2-4 sentences. Mention any visible text or logos.",
            },
            { type: "input_image", image_url: imageUrl, detail: "auto" },
          ],
        },
      ],
    }),
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    status?: string;
    output_text?: string;
    error?: { message?: string };
  };

  console.log(`elapsed: ${elapsed}s`);
  console.log(`status: ${body.status}`);
  if (body.error) console.log(`error: ${body.error.message}`);

  expect(body.status === "completed", `expected completed, got ${body.status}`);
  expect(
    typeof body.output_text === "string" && body.output_text.trim().length > 5,
    "missing output_text",
  );

  console.log("--- response ---");
  console.log(body.output_text);
  console.log("image-api smoke passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
