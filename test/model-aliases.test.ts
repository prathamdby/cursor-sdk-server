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

const quality = resolveCursorModel("composer-2.5-quality");
expect(quality.id === "composer-2.5", "quality alias should map to composer-2.5");
expect(
  quality.params?.some((param) => param.id === "fast" && param.value === "false"),
  "quality alias should set fast=false",
);

const base = resolveCursorModel("composer-2.5");
expect(base.id === "composer-2.5" && !base.params, "base model should pass through unchanged");

console.log("model alias tests passed");
