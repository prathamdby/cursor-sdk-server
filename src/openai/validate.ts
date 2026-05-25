import { OpenAIApiError, requireModel } from "./errors.ts";
import type { CreateResponseRequest } from "./types.ts";

const unsupportedIfPresent = [
  "audio",
  "background",
  "conversation",
  "prompt",
  "stream_options",
  "top_logprobs",
  "truncation",
] as const;

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function rejectUnsupported(param: string, detail?: string): never {
  throw new OpenAIApiError(
    400,
    detail ?? `Unsupported parameter: '${param}'.`,
    "unsupported_parameter",
    param,
  );
}

function validateInput(input: unknown): void {
  if (input === undefined || typeof input === "string") return;
  if (!Array.isArray(input)) {
    throw new OpenAIApiError(
      400,
      "Parameter 'input' must be a string or an array.",
      "invalid_type",
      "input",
    );
  }

  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== "object") {
      throw new OpenAIApiError(
        400,
        `Invalid input item at index ${index}.`,
        "invalid_type",
        "input",
      );
    }

    const record = item as Record<string, unknown>;
    const type = inputItemType(record);

    if (type === "item_reference") {
      rejectUnsupported("input", "Input item references are not supported yet.");
    }
    if (type === "reasoning") {
      rejectUnsupported("input", "Reasoning input items are not supported yet.");
    }
    if (type === "unknown") {
      throw new OpenAIApiError(
        400,
        `Invalid input item at index ${index}.`,
        "invalid_type",
        "input",
      );
    }
  }
}

function inputItemType(record: Record<string, unknown>): string {
  if (typeof record.type === "string") return record.type;
  if (typeof record.role === "string") return "message";
  return "unknown";
}

export function parseCreateResponseBody(body: Record<string, unknown>): CreateResponseRequest {
  requireModel(body);

  for (const key of unsupportedIfPresent) {
    if (hasOwn(body, key)) rejectUnsupported(key);
  }

  const text = body.text as { format?: { type?: string } } | undefined;
  const formatType = text?.format?.type;
  if (formatType && formatType !== "text") {
    rejectUnsupported(
      "text.format",
      `Only plain text output is supported (text.format.type='text'). Got '${formatType}'.`,
    );
  }

  if (body.temperature !== undefined && typeof body.temperature !== "number") {
    throw new OpenAIApiError(
      400,
      "Parameter 'temperature' must be a number.",
      "invalid_type",
      "temperature",
    );
  }
  if (body.top_p !== undefined && typeof body.top_p !== "number") {
    throw new OpenAIApiError(400, "Parameter 'top_p' must be a number.", "invalid_type", "top_p");
  }
  if (body.max_output_tokens !== undefined && typeof body.max_output_tokens !== "number") {
    throw new OpenAIApiError(
      400,
      "Parameter 'max_output_tokens' must be a number.",
      "invalid_type",
      "max_output_tokens",
    );
  }

  validateInput(body.input);

  return body as unknown as CreateResponseRequest;
}
