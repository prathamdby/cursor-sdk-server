import {
  applyInteractionUpdate,
  buildAssistantTextEvents,
  createStreamMappingState,
  resolveFinalAssistantText,
  suffixAfterPrefix,
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

expect(
  suffixAfterPrefix("Hello", "Hello world") === " world",
  "suffixAfterPrefix should emit suffix",
);
expect(
  suffixAfterPrefix("Hello world", "Hello") === "",
  "suffixAfterPrefix should suppress shorter replay",
);
expect(
  suffixAfterPrefix("streamed answer", "unrelated final") === "",
  "suffixAfterPrefix should suppress unrelated replay",
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

const unrelatedState = createStreamMappingState(baseBody);
applyInteractionUpdate({ type: "text-delta", text: "streamed answer" }, unrelatedState);
const unrelatedFinal = buildAssistantTextEvents(
  unrelatedState,
  resolveFinalAssistantText("unrelated final", unrelatedState.bufferedAssistantText),
);
const unrelatedFinalDeltas = unrelatedFinal.filter(
  (event) => event.type === "response.output_text.delta",
);
expect(
  unrelatedFinalDeltas.length === 0,
  "unrelated final replay should not emit duplicate full text",
);
expect(
  unrelatedState.messageItem?.content[0]?.type === "output_text" &&
    unrelatedState.messageItem.content[0].text === "unrelated final",
  "unrelated final replay should replace stored assistant text",
);

const trimState = createStreamMappingState(baseBody);
applyInteractionUpdate({ type: "text-delta", text: "  hello" }, trimState);
const trimFinal = buildAssistantTextEvents(
  trimState,
  resolveFinalAssistantText("hello world", trimState.bufferedAssistantText),
);
const trimFinalDeltas = trimFinal.filter((event) => event.type === "response.output_text.delta");
expect(trimFinalDeltas.length === 1, "trim-aware final replay should emit one suffix delta");
expect(trimFinalDeltas[0]?.delta === " world", "trim-aware final replay suffix mismatch");

const usageState = createStreamMappingState(baseBody);
applyInteractionUpdate(
  {
    type: "turn-ended",
    usage: { inputTokens: 178_862, outputTokens: 80, cacheReadTokens: 200_000 },
  },
  usageState,
);
expect(
  usageState.response.usage?.input_tokens === 0,
  "turn-ended should not expose Cursor internal input tokens",
);
expect(usageState.response.usage?.output_tokens === 80, "turn-ended should map output tokens");
expect(
  usageState.response.usage?.total_tokens === 80,
  "turn-ended should exclude Cursor internal context from total",
);
expect(
  !usageState.response.usage?.input_tokens_details,
  "turn-ended should not expose Cursor cache reads as client usage",
);

console.log("stream mapping tests passed");
