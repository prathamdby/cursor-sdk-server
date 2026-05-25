import { usageFromTurnEnded } from "../src/openai/response-object.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const body = {
  model: "composer-2.5",
  input: "Hi there! Go through this codebase.",
};
const sdkUsage = {
  inputTokens: 178_862,
  outputTokens: 80,
  cacheReadTokens: 200_000,
};

const usage = usageFromTurnEnded(body, sdkUsage);

expect(usage?.input_tokens === 9, "input tokens should be estimated from client input");
expect(usage?.output_tokens === 80, "output tokens should come from model output");
expect(usage?.total_tokens === 89, "total tokens should exclude Cursor internal context");
expect(!usage?.input_tokens_details, "Cursor cache reads should not be exposed as client usage");

expect(usageFromTurnEnded(body, undefined) === undefined, "missing usage should return undefined");
expect(
  usageFromTurnEnded({ model: "composer-2.5" }, { outputTokens: 0 })?.total_tokens === 0,
  "zero token usage should be preserved",
);

console.log("usage accounting tests passed");
