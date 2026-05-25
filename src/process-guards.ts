import { isBenignConnectrpcStreamError } from "./cursor/connect-errors.ts";

let installed = false;

function logBenignStreamError(source: "unhandledRejection" | "uncaughtException", reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.warn(
    `[cursor-sdk-server] ignored benign connectrpc stream error (${source}): ${message}`,
  );
}

function fatalProcessError(
  source: "unhandledRejection" | "uncaughtException",
  reason: unknown,
): never {
  console.error(`[cursor-sdk-server] fatal ${source}:`, reason);
  process.exit(1);
}

export function installProcessGuards(): void {
  if (installed) return;
  installed = true;

  process.on("unhandledRejection", (reason) => {
    if (isBenignConnectrpcStreamError(reason)) {
      logBenignStreamError("unhandledRejection", reason);
      return;
    }
    fatalProcessError("unhandledRejection", reason);
  });

  process.on("uncaughtException", (error) => {
    if (isBenignConnectrpcStreamError(error)) {
      logBenignStreamError("uncaughtException", error);
      return;
    }
    fatalProcessError("uncaughtException", error);
  });
}
