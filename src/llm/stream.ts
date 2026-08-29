import { LlmError } from "./errors.js";
import { SseParser } from "./sse.js";
import type {
  ChatCompletionChunk,
  ChatMessage,
  ChatResult,
  FinishReason,
  StreamEvent,
  ToolCall,
  Usage,
} from "./types.js";

interface ToolCallBuilder {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Accumulate OpenAI chat.completion.chunk SSE into a final ChatResult,
 * yielding StreamEvents along the way.
 */
export async function* iterateChatStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();

  let id = "";
  let model: string | undefined;
  let content = "";
  let reasoning = "";
  let finishReason: FinishReason | null = null;
  let usage: Usage | undefined;
  const toolBuilders = new Map<number, ToolCallBuilder>();
  let started = false;

  try {
    while (true) {
      if (signal?.aborted) {
        throw LlmError.aborted();
      }

      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      for (const frame of parser.push(text)) {
        for await (const event of handleFrame(frame.data)) {
          yield event;
        }
      }
    }

    for (const frame of parser.finish()) {
      for await (const event of handleFrame(frame.data)) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls = finalizeToolCalls(toolBuilders);
  const message: ChatMessage = {
    role: "assistant",
    content: content || (toolCalls ? null : ""),
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  };

  yield {
    type: "done",
    result: {
      message,
      finishReason,
      usage,
      model,
      id: id || undefined,
    },
  };

  async function* handleFrame(
    data: string,
  ): AsyncGenerator<StreamEvent, void, undefined> {
    if (data === "[DONE]") return;

    let chunk: ChatCompletionChunk;
    try {
      chunk = JSON.parse(data) as ChatCompletionChunk;
    } catch (err) {
      throw new LlmError({
        code: "parse",
        message: `Failed to parse SSE chunk: ${data.slice(0, 200)}`,
        cause: err,
      });
    }

    if (!started) {
      started = true;
      id = chunk.id ?? "";
      model = chunk.model;
      yield { type: "start", id, model };
    }

    if (chunk.usage) usage = chunk.usage;

    const choice = chunk.choices?.[0];
    if (!choice) return;

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }

    const delta = choice.delta ?? {};
    if (delta.content) {
      content += delta.content;
      yield { type: "text_delta", text: delta.content };
    }
    if (delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      yield { type: "reasoning_delta", text: delta.reasoning_content };
    }

    for (const tc of delta.tool_calls ?? []) {
      const index = tc.index ?? 0;
      let builder = toolBuilders.get(index);
      if (!builder) {
        builder = { id: tc.id ?? `call_${index}`, name: "", arguments: "" };
        toolBuilders.set(index, builder);
      }
      if (tc.id) builder.id = tc.id;
      if (tc.function?.name) builder.name += tc.function.name;
      if (tc.function?.arguments) builder.arguments += tc.function.arguments;

      yield {
        type: "tool_call_delta",
        index,
        id: tc.id,
        name: tc.function?.name,
        argumentsDelta: tc.function?.arguments,
      };
    }
  }
}

function finalizeToolCalls(
  builders: Map<number, ToolCallBuilder>,
): ToolCall[] | undefined {
  if (builders.size === 0) return undefined;
  return [...builders.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, b]) => ({
      id: b.id,
      type: "function" as const,
      function: {
        name: b.name,
        arguments: b.arguments || "{}",
      },
    }));
}

/** Consume a stream to a single ChatResult (last `done` event). */
export async function collectChatStream(
  events: AsyncIterable<StreamEvent>,
): Promise<ChatResult> {
  let result: ChatResult | undefined;
  for await (const event of events) {
    if (event.type === "done") result = event.result;
  }
  if (!result) {
    throw new LlmError({
      code: "empty_response",
      message: "Stream ended without a completion",
    });
  }
  return result;
}
