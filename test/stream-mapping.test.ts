import {
  applyInteractionUpdate,
  createStreamMappingState,
  resolveFinalAssistantText,
} from "../src/cursor/stream-mapping.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const baseBody = { model: "composer-2.5" };

const state = createStreamMappingState(baseBody);

const firstThinking = applyInteractionUpdate(
  { type: "thinking-delta", text: "The user intends to " },
  state,
);
const secondThinking = applyInteractionUpdate(
  { type: "thinking-delta", text: "implement API keys." },
  state,
);

const textDeltaEvents = [...firstThinking, ...secondThinking].filter(
  (event) =>
    event.type === "response.reasoning_summary_text.delta" ||
    event.type === "response.reasoning_text.delta",
);

expect(
  textDeltaEvents.every((event) => event.type === "response.reasoning_summary_text.delta"),
  "thinking-delta should emit only reasoning_summary_text.delta events",
);
expect(
  !textDeltaEvents.some((event) => event.type === "response.reasoning_text.delta"),
  "thinking-delta should not emit reasoning_text.delta events",
);
expect(textDeltaEvents.length === 2, "expected one summary delta per thinking-delta");

const summaryText = state.reasoningItem?.summary?.[0]?.text ?? "";
expect(
  summaryText === "The user intends to implement API keys.",
  `reasoning summary should not be duplicated, got: ${summaryText}`,
);

expect(
  resolveFinalAssistantText(undefined, "  streamed answer  ") === "streamed answer",
  "should fall back to buffered text when SDK result is empty",
);
expect(
  resolveFinalAssistantText("Hello", "Hello world from stream") === "Hello world from stream",
  "should prefer buffered text when final is a prefix of streamed",
);
expect(
  resolveFinalAssistantText("complete final answer", "complete final") === "complete final answer",
  "should prefer final text when streamed is a prefix of final",
);
expect(
  resolveFinalAssistantText("  trimmed  ", "  trimmed  ") === "trimmed",
  "should trim both sources before comparing",
);
expect(
  resolveFinalAssistantText("unrelated final", "unrelated streamed") === "unrelated final",
  "should keep final text when neither source is a prefix of the other",
);

console.log("stream mapping tests passed");
