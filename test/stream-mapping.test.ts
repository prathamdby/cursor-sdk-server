import {
  applyInteractionUpdateForTest,
  createStreamStateForTest,
  resolveFinalAssistantText,
} from "../src/cursor/run-response.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const baseBody = { model: "composer-2.5" };

const state = createStreamStateForTest(baseBody);

const firstThinking = applyInteractionUpdateForTest(
  { type: "thinking-delta", text: "The user intends to " },
  state,
);
const secondThinking = applyInteractionUpdateForTest(
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
  resolveFinalAssistantText("short", "much longer streamed assistant answer") ===
    "much longer streamed assistant answer",
  "should prefer longer buffered text over shorter SDK result",
);
expect(
  resolveFinalAssistantText("complete final answer", "partial") === "complete final answer",
  "should keep SDK result when it is longer than buffered text",
);
expect(
  resolveFinalAssistantText("  trimmed  ", "  trimmed  ") === "trimmed",
  "should trim both sources before comparing",
);

console.log("stream mapping tests passed");
