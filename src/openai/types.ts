export interface CreateResponseRequest {
  model: string;
  input?: string | ResponseInputItem[];
  instructions?: string;
  stream?: boolean;
  store?: boolean;
  previous_response_id?: string | null;
  conversation?: string | { id: string } | null;
  metadata?: Record<string, string>;
  tools?: ResponseTool[];
  tool_choice?: "none" | "auto" | "required" | { type: "function"; name: string };
  parallel_tool_calls?: boolean;
  max_output_tokens?: number;
  max_tool_calls?: number;
  temperature?: number;
  top_p?: number;
  reasoning?: {
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    summary?: "auto" | "concise" | "detailed" | null;
    generate_summary?: "auto" | "concise" | "detailed" | null;
  };
  text?: {
    format?: { type: "text" | "json_object" | "json_schema"; [key: string]: unknown };
    verbosity?: "low" | "medium" | "high";
  };
  include?: string[];
  background?: boolean;
  service_tier?: "auto" | "default" | "flex" | "scale" | "priority";
  prompt_cache_key?: string;
  prompt_cache_retention?: "in_memory" | "24h";
  truncation?: "auto" | "disabled";
  user?: string;
  safety_identifier?: string;
}

export type ResponseInputItem =
  | {
      type: "message";
      role: "user" | "assistant" | "system" | "developer";
      content: ResponseInputContent[];
    }
  | { type: "function_call"; id?: string; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string | ResponseInputContent[] }
  | { type: "item_reference"; id: string }
  | { type: "reasoning"; [key: string]: unknown };

export type ResponseInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" }
  | { type: "input_file"; file_id?: string; file_data?: string; filename?: string };

export type ResponseTool =
  | {
      type: "function";
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
      strict?: boolean;
    }
  | { type: string; [key: string]: unknown };

export type ResponseStatus =
  | "completed"
  | "failed"
  | "in_progress"
  | "cancelled"
  | "queued"
  | "incomplete";

export type ResponseOutputItem =
  | {
      type: "message";
      id: string;
      role: "assistant";
      status: "completed" | "incomplete" | "in_progress";
      content: Array<
        | { type: "output_text"; text: string; annotations: unknown[] }
        | { type: "refusal"; refusal: string }
      >;
    }
  | {
      type: "function_call";
      id: string;
      call_id: string;
      name: string;
      arguments: string;
      status?: "completed" | "in_progress";
    }
  | {
      type: "reasoning";
      id: string;
      summary?: Array<{ type: string; text: string }>;
      content?: Array<{ type: string; text: string }>;
    };

export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface OpenAIResponse {
  id: string;
  object: "response";
  created_at: number;
  status: ResponseStatus;
  model: string;
  output: ResponseOutputItem[];
  output_text?: string;
  usage?: ResponseUsage;
  metadata?: Record<string, string>;
  error?: { code?: string; message: string };
  incomplete_details?: { reason?: string };
  previous_response_id?: string | null;
  instructions?: string | null;
  tools?: ResponseTool[];
  parallel_tool_calls?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number | null;
  reasoning?: CreateResponseRequest["reasoning"];
  text?: CreateResponseRequest["text"];
  store?: boolean;
  service_tier?: CreateResponseRequest["service_tier"];
}

export type ResponseStreamEvent =
  | { type: "response.created"; response: OpenAIResponse }
  | { type: "response.in_progress"; response: OpenAIResponse }
  | { type: "response.output_item.added"; output_index: number; item: ResponseOutputItem }
  | {
      type: "response.content_part.added";
      output_index: number;
      content_index: number;
      item_id: string;
      part: { type: string; [key: string]: unknown };
    }
  | {
      type: "response.output_text.delta";
      output_index: number;
      content_index: number;
      delta: string;
      item_id: string;
      logprobs?: unknown[];
    }
  | {
      type: "response.output_text.done";
      output_index: number;
      content_index: number;
      text: string;
      item_id: string;
    }
  | {
      type: "response.content_part.done";
      output_index: number;
      content_index: number;
      item_id: string;
      part: { type: string; [key: string]: unknown };
    }
  | { type: "response.output_item.done"; output_index: number; item: ResponseOutputItem }
  | {
      type: "response.function_call_arguments.delta";
      output_index: number;
      item_id: string;
      delta: string;
    }
  | {
      type: "response.function_call_arguments.done";
      output_index: number;
      item_id: string;
      arguments: string;
    }
  | {
      type: "response.reasoning_summary_part.added";
      output_index: number;
      item_id: string;
      summary_index: number;
      part: { type: string; text: string };
    }
  | {
      type: "response.reasoning_summary_text.delta";
      output_index: number;
      item_id: string;
      summary_index: number;
      delta: string;
    }
  | {
      type: "response.reasoning_summary_part.done";
      output_index: number;
      item_id: string;
      summary_index: number;
      part: { type: string; text: string };
    }
  | {
      type: "response.reasoning_text.delta";
      output_index: number;
      item_id: string;
      content_index: number;
      delta: string;
    }
  | { type: "response.completed"; response: OpenAIResponse }
  | { type: "response.cancelled"; response: OpenAIResponse }
  | { type: "response.failed"; response: OpenAIResponse }
  | { type: "response.incomplete"; response: OpenAIResponse }
  | { type: "error"; code?: string; message: string; param?: string | null };
