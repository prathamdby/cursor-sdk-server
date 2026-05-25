import { usageFromTurnEnded } from "../src/openai/response-object.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const sdkUsage = {
  inputTokens: 1200,
  outputTokens: 80,
  cacheReadTokens: 200_000,
};

const usage = usageFromTurnEnded(sdkUsage);

expect(usage?.input_tokens === 1200, "input tokens should come from live input");
expect(usage?.output_tokens === 80, "output tokens should come from model output");
expect(usage?.total_tokens === 1280, "total tokens should exclude Cursor cache reads");
expect(!usage?.input_tokens_details, "Cursor cache reads should not be exposed as client usage");

expect(usageFromTurnEnded(undefined) === undefined, "missing usage should return undefined");
expect(
  usageFromTurnEnded({ inputTokens: 0, outputTokens: 0 })?.total_tokens === 0,
  "zero token usage should be preserved",
);

console.log("usage accounting tests passed");
