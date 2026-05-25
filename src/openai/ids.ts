import { randomBytes } from "node:crypto";

export function createResponseId(): string {
  return `resp_${randomBytes(16).toString("hex")}`;
}

export function createItemId(prefix: "msg" | "rs"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}
