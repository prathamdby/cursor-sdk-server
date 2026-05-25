import { resolveCursorModel } from "../src/cursor/models.ts";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const fast = resolveCursorModel("composer-2.5-fast");
expect(fast.id === "composer-2.5", "fast alias should map to composer-2.5");
expect(
  fast.params?.some((param) => param.id === "fast" && param.value === "true"),
  "fast alias should set fast=true",
);

const base = resolveCursorModel("composer-2.5");
expect(base.id === "composer-2.5", "base model should map to composer-2.5");
expect(
  base.params?.some((param) => param.id === "fast" && param.value === "false"),
  "base model should set fast=false",
);

console.log("model alias tests passed");
