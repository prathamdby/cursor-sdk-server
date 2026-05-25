import {
  applyInteractionUpdate,
  buildAssistantTextEvents,
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

const textState = createStreamMappingState(baseBody);
const firstText = applyInteractionUpdate({ type: "text-delta", text: "Hello " }, textState);
const secondText = applyInteractionUpdate({ type: "text-delta", text: "from stream" }, textState);
const textDeltas = [...firstText, ...secondText].filter(
  (event) => event.type === "response.output_text.delta",
);

expect(textDeltas.length === 2, "text-delta should stream immediately");
expect(
  textDeltas.map((event) => event.delta).join("") === "Hello from stream",
  "streamed text deltas should match SDK text",
);
expect(
  textState.messageItem?.content[0]?.type === "output_text" &&
    textState.messageItem.content[0].text === "Hello from stream",
  "message item should accumulate streamed text",
);

const finalSuffix = buildAssistantTextEvents(textState, "Hello from stream with final suffix");
const finalSuffixDeltas = finalSuffix.filter(
  (event) => event.type === "response.output_text.delta",
);
expect(finalSuffixDeltas.length === 1, "final replay should emit only missing suffix");
expect(finalSuffixDeltas[0]?.delta === " with final suffix", "final replay suffix mismatch");

const duplicateFinal = buildAssistantTextEvents(textState, "Hello from stream with final suffix");
expect(
  duplicateFinal.every((event) => event.type !== "response.output_text.delta"),
  "identical final text should not emit duplicate deltas",
);

console.log("stream mapping tests passed");
