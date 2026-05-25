import { encodeSseKeepaliveChunk } from "../src/openai/stream.ts";
import type { OpenAIResponse } from "../src/openai/types.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const commentOnly = encodeSseKeepaliveChunk();
expect(commentOnly === ": keepalive\n\n", "missing snapshot should use SSE comment keepalive");

const snapshot: OpenAIResponse = {
  id: "resp_test",
  object: "response",
  created_at: 1,
  status: "in_progress",
  model: "composer-2.5",
  output: [
    {
      type: "message",
      id: "msg_test",
      role: "assistant",
      status: "in_progress",
      content: [{ type: "output_text", text: "hi", annotations: [] }],
    },
  ],
};

const withSnapshot = encodeSseKeepaliveChunk(snapshot);
expect(withSnapshot.startsWith("data: "), "snapshot keepalive should be a data event");
expect(withSnapshot.includes("resp_test"), "snapshot keepalive should include response id");
expect(withSnapshot.includes('"hi"'), "snapshot keepalive should preserve output text");

console.log("sse stream tests passed");
