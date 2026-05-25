export function isBenignConnectrpcStreamError(reason: unknown): boolean {
  const parts: string[] = [];

  if (reason instanceof Error) {
    parts.push(reason.message);
    if ("code" in reason && typeof reason.code === "string") {
      parts.push(reason.code);
    }
  } else {
    parts.push(String(reason));
  }

  const text = parts.join(" ");
  return (
    text.includes("NGHTTP2_FRAME_SIZE_ERROR") ||
    text.includes("ERR_HTTP2_STREAM_ERROR") ||
    (text.includes("Stream closed with error code") && text.includes("NGHTTP2"))
  );
}

export function agentErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
