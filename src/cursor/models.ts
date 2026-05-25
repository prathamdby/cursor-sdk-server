import type { ModelListItem, ModelParameterValue, ModelSelection } from "@cursor/sdk";
import type { CreateResponseRequest } from "../openai/types.ts";
import { mapReasoningEffort } from "../openai/input.ts";

const FAST_SUFFIX = "-fast";
const QUALITY_SUFFIXES = ["-quality", "-slow"] as const;

export function resolveCursorModel(
  requestModel: string,
  reasoning?: CreateResponseRequest["reasoning"],
): ModelSelection {
  const trimmed = requestModel.trim();
  const params: ModelParameterValue[] = [];
  let id = trimmed;

  if (trimmed.endsWith(FAST_SUFFIX)) {
    id = trimmed.slice(0, -FAST_SUFFIX.length);
    params.push({ id: "fast", value: "true" });
  } else {
    for (const suffix of QUALITY_SUFFIXES) {
      if (trimmed.endsWith(suffix)) {
        id = trimmed.slice(0, -suffix.length);
        params.push({ id: "fast", value: "false" });
        break;
      }
    }
  }

  const thinking = mapReasoningEffort(reasoning);
  if (thinking) params.push(thinking);

  return params.length > 0 ? { id, params } : { id };
}

export function listOpenAIModelIds(models: ModelListItem[]): string[] {
  const ids = new Set<string>();

  for (const model of models) {
    ids.add(model.id);
    if (model.parameters?.some((parameter) => parameter.id === "fast")) {
      ids.add(`${model.id}${FAST_SUFFIX}`);
      ids.add(`${model.id}-quality`);
    }
  }

  return [...ids].toSorted();
}
