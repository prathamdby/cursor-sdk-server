import { agentErrorMessage, isBenignConnectrpcStreamError } from "../src/cursor/connect-errors.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

expect(
  isBenignConnectrpcStreamError(
    new Error("Stream closed with error code NGHTTP2_FRAME_SIZE_ERROR"),
  ),
  "should detect NGHTTP2 frame size message",
);
expect(
  isBenignConnectrpcStreamError(
    Object.assign(new Error("stream error"), { code: "ERR_HTTP2_STREAM_ERROR" }),
  ),
  "should detect ERR_HTTP2_STREAM_ERROR code",
);
expect(
  !isBenignConnectrpcStreamError(new Error("something else broke")),
  "should not mark unrelated errors benign",
);
expect(agentErrorMessage(new Error("boom")) === "boom", "should extract error message");

console.log("connect-errors tests passed");
