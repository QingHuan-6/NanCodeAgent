import type { ChatMessage, OpenAIToolDefinition } from "../../src/llm/types.js";
import type { LlmChatPort } from "../../src/agent/types.js";

/**
 * Scripted LLM for agent-loop tests (no network).
 * Each call to chat() returns the next message in `responses`.
 */
export class ScriptedLlm implements LlmChatPort {
  readonly calls: Array<{
    messages: ChatMessage[];
    tools?: OpenAIToolDefinition[];
  }> = [];

  private index = 0;

  constructor(private readonly responses: ChatMessage[]) {}

  async chat(
    messages: ChatMessage[],
    tools?: OpenAIToolDefinition[],
  ): Promise<ChatMessage> {
    this.calls.push({
      messages: structuredClone(messages),
      tools,
    });
    const next = this.responses[this.index];
    if (!next) {
      throw new Error(
        `ScriptedLlm: no response for call #${this.index + 1} (only ${this.responses.length} scripted)`,
      );
    }
    this.index += 1;
    return structuredClone(next);
  }
}

/** Like ScriptedLlm but exposes streamChat that yields text deltas. */
export class StreamingScriptedLlm extends ScriptedLlm {
  async *streamChat(
    messages: ChatMessage[],
    options: { tools?: OpenAIToolDefinition[]; signal?: AbortSignal } = {},
  ): AsyncGenerator<
    import("../../src/llm/types.js").StreamEvent,
    import("../../src/llm/types.js").ChatResult,
    undefined
  > {
    const message = await this.chat(messages, options.tools);
    yield { type: "start", id: "scripted" };
    if (message.content) {
      // Emit in small chunks so message_delta is exercised
      const text = message.content;
      const mid = Math.max(1, Math.floor(text.length / 2));
      yield { type: "text_delta", text: text.slice(0, mid) };
      if (mid < text.length) {
        yield { type: "text_delta", text: text.slice(mid) };
      }
    }
    const result = {
      message,
      finishReason: message.tool_calls?.length ? ("tool_calls" as const) : ("stop" as const),
    };
    yield { type: "done", result };
    return result;
  }
}

export function assistantText(text: string): ChatMessage {
  return { role: "assistant", content: text };
}

export function assistantToolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ChatMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id,
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(args),
        },
      },
    ],
  };
}
