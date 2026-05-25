import type { CreateResponseRequest, ResponseInputContent, ResponseInputItem } from "./types.ts";
import type { SDKImage, SDKUserMessage } from "@cursor/sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type LooseInputItem = ResponseInputItem | { role?: string; content?: unknown; type?: string };

function contentToText(content: ResponseInputContent): string {
  if (content.type === "input_text") return content.text;
  if (content.type === "input_image") return "[image]";
  if (content.type === "input_file") return `[file:${content.filename ?? "attachment"}]`;
  return "";
}

function parseImageUrl(imageUrl: string): SDKImage | undefined {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(imageUrl);
  if (!match) return undefined;
  return { data: match[2], mimeType: match[1] };
}

function normalizeContentPart(part: unknown): ResponseInputContent | undefined {
  if (!part || typeof part !== "object") return undefined;
  const record = part as Record<string, unknown>;
  if (record.type === "input_text" && typeof record.text === "string") {
    return { type: "input_text", text: record.text };
  }
  if (record.type === "output_text" && typeof record.text === "string") {
    return { type: "input_text", text: record.text };
  }
  if (record.type === "input_image" && typeof record.image_url === "string") {
    return {
      type: "input_image",
      image_url: record.image_url,
      detail: record.detail as "auto" | "low" | "high" | undefined,
    };
  }
  if (record.type === "input_file") {
    return {
      type: "input_file",
      file_id: typeof record.file_id === "string" ? record.file_id : undefined,
      file_data: typeof record.file_data === "string" ? record.file_data : undefined,
      filename: typeof record.filename === "string" ? record.filename : undefined,
    };
  }
  return undefined;
}

function normalizeMessageContent(content: unknown): ResponseInputContent[] {
  if (typeof content === "string") return [{ type: "input_text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    const normalized = normalizeContentPart(part);
    return normalized ? [normalized] : [];
  });
}

function inputItemKind(item: LooseInputItem): string {
  if (typeof item.type === "string") return item.type;
  if ("role" in item && typeof item.role === "string") return "message";
  return "unknown";
}

function messageRole(item: LooseInputItem): string {
  if (item.type === "message" && item.role) return item.role;
  if ("role" in item && typeof item.role === "string") return item.role;
  return "user";
}

function normalizeInputItems(input: ResponseInputItem[]): { prompt: string; images: SDKImage[] } {
  const sections: string[] = [];
  const images: SDKImage[] = [];

  for (const item of input) {
    const kind = inputItemKind(item);
    if (kind === "function_call") {
      if (item.type === "function_call") {
        sections.push(`Assistant tool call (${item.name}, id ${item.call_id}):\n${item.arguments}`);
      }
      continue;
    }
    if (kind === "function_call_output") {
      if (item.type === "function_call_output") {
        const output =
          typeof item.output === "string"
            ? item.output
            : normalizeMessageContent(item.output).map(contentToText).filter(Boolean).join("\n");
        sections.push(`Tool result (${item.call_id}):\n${output}`);
      }
      continue;
    }
    if (kind !== "message") continue;

    const content = normalizeMessageContent("content" in item ? item.content : undefined);
    const textParts = content.map(contentToText).filter(Boolean);
    for (const part of content) {
      if (part.type === "input_image") {
        const image = parseImageUrl(part.image_url);
        if (image) images.push(image);
      }
    }
    if (textParts.length) sections.push(`${messageRole(item)}:\n${textParts.join("\n")}`);
  }

  return { prompt: sections.join("\n\n"), images };
}

export function buildCursorPrompt(body: CreateResponseRequest): SDKUserMessage {
  const sections: string[] = [];

  if (body.instructions?.trim()) {
    sections.push(`instructions:\n${body.instructions.trim()}`);
  }

  let images: SDKImage[] = [];
  if (typeof body.input === "string") {
    if (body.input.trim()) sections.push(body.input.trim());
  } else if (Array.isArray(body.input)) {
    const normalized = normalizeInputItems(body.input);
    if (normalized.prompt.trim()) sections.push(normalized.prompt.trim());
    images = normalized.images;
  }

  const text = sections.join("\n\n");
  if (images.length > 0) {
    return { text, images };
  }
  return { text };
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "png";
}

export function materializePromptImages(prompt: SDKUserMessage): SDKUserMessage {
  if (!prompt.images?.length) return prompt;

  const dir = mkdtempSync(join(tmpdir(), "cursor-sdk-server-"));
  const paths: string[] = [];

  for (const [index, image] of prompt.images.entries()) {
    if (!("data" in image)) continue;
    const path = join(dir, `image-${index + 1}.${extensionForMime(image.mimeType)}`);
    writeFileSync(path, Buffer.from(image.data, "base64"));
    paths.push(path);
  }

  if (paths.length === 0) return { text: prompt.text };

  return {
    text: `${prompt.text}\n\nAttached image files:\n${paths.map((path) => `- ${path}`).join("\n")}`,
  };
}

export function mapReasoningEffort(
  reasoning?: CreateResponseRequest["reasoning"],
): { id: string; value: string } | undefined {
  const effort = reasoning?.effort;
  if (!effort || effort === "none" || effort === "minimal") return undefined;
  const value = effort === "xhigh" ? "high" : effort;
  return { id: "thinking", value };
}
