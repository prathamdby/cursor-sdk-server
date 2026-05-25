import type { ModelListItem, ModelParameterValue, ModelSelection } from "@cursor/sdk";
import type { CreateResponseRequest } from "../openai/types.ts";
import { mapReasoningEffort } from "../openai/input.ts";

const FAST_SUFFIX = "-fast";

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
    params.push({ id: "fast", value: "false" });
  }

  const thinking = mapReasoningEffort(reasoning);
  if (thinking) params.push(thinking);

  return { id, params };
}

export function listOpenAIModelIds(models: ModelListItem[]): string[] {
  const ids = new Set<string>();

  for (const model of models) {
    ids.add(model.id);
    if (model.parameters?.some((parameter) => parameter.id === "fast")) {
      ids.add(`${model.id}${FAST_SUFFIX}`);
    }
  }

  return [...ids].toSorted();
}
