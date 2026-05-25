import { usageFromTurnEnded } from "../src/openai/response-object.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const usage = usageFromTurnEnded({
  inputTokens: 1200,
  outputTokens: 80,
  cacheReadTokens: 200_000,
});

expect(usage?.input_tokens === 1200, "input tokens should come from live input");
expect(usage?.output_tokens === 80, "output tokens should come from model output");
expect(usage?.total_tokens === 1280, "total tokens should exclude Cursor cache reads");
expect(!usage?.input_tokens_details, "Cursor cache reads should not be exposed as client usage");

console.log("usage accounting tests passed");
