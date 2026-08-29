export { LlmClient } from "./client.js";
export type { LlmClientOptions } from "./client.js";
export { LlmError, classifyHttpError } from "./errors.js";
export type { LlmErrorCode } from "./errors.js";
export {
  buildChatCompletionBody,
  chatCompletionsUrl,
  isReasoningModel,
  normalizeMessagesForApi,
} from "./message.js";
export { SseParser } from "./sse.js";
export { collectChatStream, iterateChatStream } from "./stream.js";
export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatRequestOptions,
  ChatResult,
  FinishReason,
  OpenAIToolDefinition,
  Role,
  StreamEvent,
  ToolCall,
  ToolChoice,
  ToolParameterSchema,
  Usage,
} from "./types.js";
