import type { OpenAIResponse } from "../openai/types.ts";

export interface StoredResponse {
  response: OpenAIResponse;
  agentId?: string;
  abort?: () => Promise<void>;
}

const responses = new Map<string, StoredResponse>();
const previousToAgent = new Map<string, string>();

export function storeResponse(id: string, entry: StoredResponse): void {
  responses.set(id, entry);
  if (entry.agentId) {
    previousToAgent.set(id, entry.agentId);
  }
}

export function getStoredResponse(id: string): StoredResponse | undefined {
  return responses.get(id);
}

export function resolveAgentId(previousResponseId?: string | null): string | undefined {
  if (!previousResponseId) return undefined;
  return previousToAgent.get(previousResponseId);
}

export function linkAgent(responseId: string, agentId: string): void {
  previousToAgent.set(responseId, agentId);
}

export function deleteStoredResponse(id: string): void {
  responses.delete(id);
}
