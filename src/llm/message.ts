import type { ChatMessage, ChatCompletionRequest } from "./types.js";

/**
 * Normalize messages before sending to OpenAI-compatible gateways.
 * Some providers reject `tool_calls: null/[]` or missing tool_call_id.
 */
export function normalizeMessagesForApi(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(normalizeMessage).filter((m) => m !== null) as ChatMessage[];
}

function normalizeMessage(message: ChatMessage): ChatMessage | null {
  const role = message.role;

  if (role === "tool") {
    return {
      role: "tool",
      content: message.content ?? "",
      tool_call_id: message.tool_call_id ?? "",
      ...(message.name ? { name: message.name } : {}),
    };
  }

  if (role === "assistant") {
    const out: ChatMessage = {
      role: "assistant",
      content: message.content,
    };
    const tools = message.tool_calls?.filter((t) => t?.function?.name);
    if (tools && tools.length > 0) {
      out.tool_calls = tools.map((t) => ({
        id: t.id,
        type: "function" as const,
        function: {
          name: t.function.name,
          arguments: t.function.arguments ?? "{}",
        },
      }));
      // Providers often want content null or "" alongside tool_calls
      if (out.content === undefined) out.content = null;
    } else {
      out.content = message.content ?? "";
    }
    if (message.reasoning_content) {
      out.reasoning_content = message.reasoning_content;
    }
    return out;
  }

  return {
    role,
    content: message.content ?? "",
    ...(message.name ? { name: message.name } : {}),
  };
}

/** Models that typically reject temperature / top_p. */
export function isReasoningModel(model: string): boolean {
  const lowered = model.toLowerCase();
  const canonical = lowered.split("/").pop() ?? lowered;
  return (
    canonical.startsWith("o1") ||
    canonical.startsWith("o3") ||
    canonical.startsWith("o4") ||
    canonical.includes("reasoning") ||
    canonical.includes("thinking") ||
    canonical.startsWith("qwq") ||
    canonical.startsWith("qwen-qwq")
  );
}

export function buildChatCompletionBody(input: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatCompletionRequest["tools"];
  toolChoice?: ChatCompletionRequest["tool_choice"];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
  includeUsage?: boolean;
}): ChatCompletionRequest {
  const body: ChatCompletionRequest = {
    model: input.model,
    messages: normalizeMessagesForApi(input.messages),
  };

  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools;
    body.tool_choice = input.toolChoice ?? "auto";
  }

  if (!isReasoningModel(input.model)) {
    if (input.temperature !== undefined) body.temperature = input.temperature;
    if (input.topP !== undefined) body.top_p = input.topP;
  }

  if (input.maxTokens !== undefined) {
    body.max_tokens = input.maxTokens;
  }

  if (input.stream) {
    body.stream = true;
    if (input.includeUsage) {
      body.stream_options = { include_usage: true };
    }
  }

  return body;
}

/** Join base URL with /chat/completions without duplicating the path. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}
