import { readFileSync } from "node:fs";
import { getTestBaseUrl } from "./helpers/env.ts";

const baseUrl = getTestBaseUrl();
const imagePath =
  process.argv[2] ?? "/home/prathamd/Downloads/Telegram Desktop/photo_2026-05-25_20-38-03.jpg";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const bytes = readFileSync(imagePath);
  const imageUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;

  console.log(`image: ${imagePath} (${bytes.length} bytes)`);
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
    typeof body.output_text === "string" && body.output_text.trim().length > 20,
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
