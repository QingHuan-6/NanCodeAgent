/**
 * OpenAI-compatible chat / tool-calling types.
 * No agent-framework dependency — plain HTTP shapes only.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "function_call"
  | string;

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: ToolCallFunction;
  index?: number;
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  /** Some gateways echo reasoning; kept optional for round-trips. */
  reasoning_content?: string | null;
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
}

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: OpenAIToolDefinition[];
  tool_choice?: ToolChoice;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  user?: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: FinishReason | null;
}

export interface ChatCompletionResponse {
  id: string;
  object?: string;
  created?: number;
  model?: string;
  choices: ChatCompletionChoice[];
  usage?: Usage;
}

/** Streaming chunk (OpenAI chat.completion.chunk). */
export interface ChatCompletionChunk {
  id: string;
  object?: string;
  created?: number;
  model?: string;
  choices: ChatCompletionChunkChoice[];
  usage?: Usage;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionDelta;
  finish_reason: FinishReason | null;
}

export interface ChatCompletionDelta {
  role?: Role;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCallDelta[];
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChatRequestOptions {
  tools?: OpenAIToolDefinition[];
  toolChoice?: ToolChoice;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Override model for this call. */
  model?: string;
  /** Include usage on stream final chunk when supported. */
  includeUsage?: boolean;
}

export interface ChatResult {
  message: ChatMessage;
  finishReason: FinishReason | null;
  usage?: Usage;
  model?: string;
  id?: string;
  requestId?: string;
}

/** Incremental events while streaming a completion. */
export type StreamEvent =
  | { type: "start"; id: string; model?: string }
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | {
      type: "tool_call_delta";
      index: number;
      id?: string;
      name?: string;
      argumentsDelta?: string;
    }
  | {
      type: "done";
      result: ChatResult;
    };
