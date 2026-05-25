export function isBenignConnectrpcStreamError(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;

  const message = reason.message;
  const code = "code" in reason && typeof reason.code === "string" ? reason.code : "";

  const isStreamClosedWithNghttp2 =
    message.includes("Stream closed with error code") && message.includes("NGHTTP2");

  if (isStreamClosedWithNghttp2) return true;

  return code === "ERR_HTTP2_STREAM_ERROR" && message.includes("Stream closed with error code");
}

export function agentErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
