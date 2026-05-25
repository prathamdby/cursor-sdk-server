import {
  canRecoverBenignStreamError,
  hasPartialStreamContent,
} from "../src/cursor/stream-recovery.ts";
import { createStreamMappingState } from "../src/cursor/stream-mapping.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const baseBody = { model: "composer-2.5" };
const emptyState = createStreamMappingState(baseBody);

const benignError = Object.assign(
  new Error("Stream closed with error code NGHTTP2_PROTOCOL_ERROR"),
  { code: "ERR_HTTP2_STREAM_ERROR" },
);

expect(
  !canRecoverBenignStreamError(benignError, emptyState),
  "benign error without partial content should not recover",
);

const partialState = createStreamMappingState(baseBody);
partialState.bufferedAssistantText = "partial answer";

expect(
  canRecoverBenignStreamError(benignError, partialState),
  "benign error with buffered text should recover",
);

expect(
  hasPartialStreamContent(partialState),
  "buffered text should count as partial stream content",
);

const nonBenign = new Error("something else");
expect(
  !canRecoverBenignStreamError(nonBenign, partialState),
  "non-benign errors should not recover",
);

console.log("stream recovery tests passed");
