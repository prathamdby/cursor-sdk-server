import { installProcessGuards } from "../../src/process-guards.ts";

installProcessGuards();

const mode = process.argv[2];

if (mode === "benign-rejection") {
  Promise.reject(new Error("Stream closed with error code NGHTTP2_FRAME_SIZE_ERROR"));
} else if (mode === "fatal-rejection") {
  Promise.reject(new Error("database connection lost"));
} else if (mode === "benign-exception") {
  throw Object.assign(new Error("Stream closed with error code NGHTTP2_PROTOCOL_ERROR"), {
    code: "ERR_HTTP2_STREAM_ERROR",
  });
} else if (mode === "fatal-exception") {
  throw new Error("unexpected crash");
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}

setTimeout(() => {
  console.log("still alive");
}, 200);
