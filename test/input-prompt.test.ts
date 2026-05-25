import type { CreateResponseRequest } from "../src/openai/types.ts";
import { buildCursorPrompt, materializePromptImages } from "../src/openai/input.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const piShape = buildCursorPrompt({
  model: "composer-2.5",
  input: [
    {
      role: "developer",
      content: "You are a coding agent.",
    },
    {
      role: "user",
      content: [{ type: "input_text", text: "Hi there, Pi! Go through this codebase." }],
    },
  ] as CreateResponseRequest["input"],
});

expect(
  piShape.text.includes("Hi there, Pi! Go through this codebase."),
  "pi user message missing from prompt",
);
expect(piShape.text.includes("developer:"), "pi developer message missing from prompt");
expect(piShape.text.includes("You are a coding agent."), "developer content missing from prompt");

const typedAssistant = buildCursorPrompt({
  model: "composer-2.5",
  input: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "input_text", text: "Earlier reply" }],
    },
    {
      role: "user",
      content: "Follow up",
    },
  ] as CreateResponseRequest["input"],
});

expect(typedAssistant.text.includes("Earlier reply"), "assistant output_text missing from prompt");
expect(typedAssistant.text.includes("Follow up"), "string user content missing from prompt");

const redPixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z4/EHwAFAgGAKr+1/wAAAABJRU5ErkJggg==";

const piImage = buildCursorPrompt({
  model: "composer-2.5-fast",
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "What color is this image?" },
        { type: "input_image", image_url: redPixel, detail: "auto" },
      ],
    },
  ] as CreateResponseRequest["input"],
});

const image = piImage.images?.[0];
expect(
  Array.isArray(piImage.images) && piImage.images.length === 1,
  "image prompt should include one image",
);
expect(image && "data" in image && image.mimeType === "image/png", "image mime type mismatch");
expect(image && "data" in image && image.data.length > 0, "image data missing");
expect(piImage.text.includes("What color is this image?"), "image prompt text missing");

const materialized = materializePromptImages(piImage);
expect(!materialized.images?.length, "materialized prompt should not keep SDK images array");
expect(
  materialized.text.includes("Attached image files:"),
  "materialized prompt missing image paths",
);
expect(/image-1\.png/.test(materialized.text), "materialized prompt missing png path");

console.log("input prompt tests passed");
