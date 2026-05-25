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
    Object.assign(new Error("Stream closed with error code NGHTTP2_PROTOCOL_ERROR"), {
      code: "ERR_HTTP2_STREAM_ERROR",
    }),
  ),
  "should detect ERR_HTTP2_STREAM_ERROR with stream-closed message",
);
expect(
  !isBenignConnectrpcStreamError(
    Object.assign(new Error("stream error"), { code: "ERR_HTTP2_STREAM_ERROR" }),
  ),
  "ERR_HTTP2_STREAM_ERROR alone should not be benign without stream-closed message",
);
expect(
  !isBenignConnectrpcStreamError(new Error("something else broke")),
  "should not mark unrelated errors benign",
);
expect(
  !isBenignConnectrpcStreamError(new Error("NGHTTP2_FRAME_SIZE_ERROR")),
  "NGHTTP2 substring alone should not be benign without stream-closed message",
);
expect(agentErrorMessage(new Error("boom")) === "boom", "should extract error message");

console.log("connect-errors tests passed");
