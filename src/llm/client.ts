import {
  classifyHttpError,
  LlmError,
  parseRetryAfterMs,
} from "./errors.js";
import { buildChatCompletionBody, chatCompletionsUrl } from "./message.js";
import { collectChatStream, iterateChatStream } from "./stream.js";
import type {
  ChatMessage,
  ChatRequestOptions,
  ChatResult,
  OpenAIToolDefinition,
  StreamEvent,
} from "./types.js";

export interface LlmClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Default sampling temperature (ignored for reasoning models). */
  temperature?: number;
  /** Max retry attempts after the first try (default 3). */
  maxRetries?: number;
  /** Initial backoff in ms (default 500). */
  initialBackoffMs?: number;
  /** Cap backoff in ms (default 20_000). */
  maxBackoffMs?: number;
  /** Per-request timeout in ms (default 120_000). 0 = disabled. */
  timeoutMs?: number;
  /** Extra headers (e.g. provider-specific). */
  defaultHeaders?: Record<string, string>;
}

/**
 * OpenAI-compatible Chat Completions client.
 * Handles request shaping, retries, AbortSignal, and optional SSE streaming.
 */
export class LlmClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: LlmClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.temperature = options.temperature ?? 0.2;
    this.maxRetries = options.maxRetries ?? 3;
    this.initialBackoffMs = options.initialBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 20_000;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  get baseUrlValue(): string {
    return this.baseUrl;
  }

  /**
   * Convenience API used by the agent loop: returns the assistant message only.
   */
  async chat(
    messages: ChatMessage[],
    tools?: OpenAIToolDefinition[],
    options?: Omit<ChatRequestOptions, "tools">,
  ): Promise<ChatMessage> {
    const result = await this.chatResult(messages, { ...options, tools });
    return result.message;
  }

  /** Full non-streaming chat with usage / finish_reason. */
  async chatResult(
    messages: ChatMessage[],
    options: ChatRequestOptions = {},
  ): Promise<ChatResult> {
    const model = options.model ?? this.model;
    const body = buildChatCompletionBody({
      model,
      messages,
      tools: options.tools,
      toolChoice: options.toolChoice,
      temperature: options.temperature ?? this.temperature,
      topP: options.topP,
      maxTokens: options.maxTokens,
      stream: false,
    });

    const { response, requestId } = await this.fetchWithRetry(
      body,
      options.signal,
    );

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new LlmError({
        code: "parse",
        message: "Failed to parse chat completion JSON",
        requestId,
        cause: err,
      });
    }

    return parseChatCompletionJson(data, requestId);
  }

  /**
   * Streaming chat. Yields text / tool deltas and a final `done` event.
   * Prefer this when the CLI should show tokens as they arrive.
   */
  async *streamChat(
    messages: ChatMessage[],
    options: ChatRequestOptions = {},
  ): AsyncGenerator<StreamEvent, ChatResult, undefined> {
    const model = options.model ?? this.model;
    const body = buildChatCompletionBody({
      model,
      messages,
      tools: options.tools,
      toolChoice: options.toolChoice,
      temperature: options.temperature ?? this.temperature,
      topP: options.topP,
      maxTokens: options.maxTokens,
      stream: true,
      includeUsage: options.includeUsage ?? true,
    });

    const { response, requestId } = await this.fetchWithRetry(
      body,
      options.signal,
    );

    if (!response.body) {
      throw new LlmError({
        code: "empty_response",
        message: "Streaming response missing body",
        requestId,
      });
    }

    let final: ChatResult | undefined;
    for await (const event of iterateChatStream(response.body, options.signal)) {
      if (event.type === "done") {
        final = { ...event.result, requestId };
        yield { type: "done", result: final };
      } else {
        yield event;
      }
    }

    if (!final) {
      throw new LlmError({
        code: "empty_response",
        message: "Stream ended without completion",
        requestId,
      });
    }
    return final;
  }

  /** Stream and collect into one ChatResult. */
  async chatStreamResult(
    messages: ChatMessage[],
    options: ChatRequestOptions = {},
  ): Promise<ChatResult> {
    return collectChatStream(this.streamChat(messages, options));
  }

  private async fetchWithRetry(
    body: unknown,
    outerSignal?: AbortSignal,
  ): Promise<{ response: Response; requestId?: string }> {
    let attempt = 0;
    let lastError: LlmError | undefined;

    while (attempt <= this.maxRetries) {
      attempt += 1;
      throwIfAborted(outerSignal);

      const { signal, clear } = mergeTimeoutSignal(outerSignal, this.timeoutMs);

      try {
        const response = await fetch(chatCompletionsUrl(this.baseUrl), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...this.defaultHeaders,
          },
          body: JSON.stringify(body),
          signal,
        });
        clear();

        const requestId =
          response.headers.get("x-request-id") ??
          response.headers.get("request-id") ??
          undefined;

        if (response.ok) {
          return { response, requestId };
        }

        const text = await response.text();
        let error = classifyHttpError(response.status, text, requestId);
        const retryAfter = parseRetryAfterMs(
          response.headers.get("retry-after"),
        );
        if (retryAfter !== undefined && error.retryable) {
          error = new LlmError({
            code: error.code,
            message: error.message,
            status: error.status,
            requestId: error.requestId,
            retryable: true,
            retryAfterMs: retryAfter,
            bodySnippet: error.bodySnippet,
          });
        }

        lastError = error;
        if (!error.retryable || attempt > this.maxRetries) {
          throw error;
        }
        await sleep(error.retryAfterMs ?? this.backoffMs(attempt), outerSignal);
      } catch (err) {
        clear();
        if (isAbortError(err) || outerSignal?.aborted) {
          throw LlmError.aborted();
        }
        if (LlmError.isLlmError(err)) {
          lastError = err;
          if (!err.retryable || attempt > this.maxRetries) throw err;
          await sleep(err.retryAfterMs ?? this.backoffMs(attempt), outerSignal);
          continue;
        }

        // Network / fetch failures — retry
        lastError = new LlmError({
          code: "network",
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
          cause: err,
        });
        if (attempt > this.maxRetries) break;
        await sleep(this.backoffMs(attempt), outerSignal);
      }
    }

    throw new LlmError({
      code: "retries_exhausted",
      message: `LLM request failed after ${attempt} attempt(s): ${lastError?.message ?? "unknown"}`,
      retryable: false,
      cause: lastError,
      status: lastError?.status,
      requestId: lastError?.requestId,
    });
  }

  private backoffMs(attempt: number): number {
    const exp = this.initialBackoffMs * 2 ** Math.max(0, attempt - 1);
    const capped = Math.min(exp, this.maxBackoffMs);
    const jitter = Math.floor(Math.random() * Math.min(250, capped / 4));
    return capped + jitter;
  }
}

function parseChatCompletionJson(
  data: unknown,
  requestId?: string,
): ChatResult {
  if (!data || typeof data !== "object") {
    throw new LlmError({
      code: "parse",
      message: "Chat completion response is not an object",
      requestId,
    });
  }

  const obj = data as Record<string, unknown>;
  if (obj.error && typeof obj.error === "object") {
    const errObj = obj.error as Record<string, unknown>;
    const message = String(errObj.message ?? JSON.stringify(obj.error));
    throw new LlmError({
      code: "bad_request",
      message,
      requestId,
      bodySnippet: message.slice(0, 800),
    });
  }

  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LlmError({
      code: "empty_response",
      message: "LLM response missing choices[0]",
      requestId,
      bodySnippet: JSON.stringify(obj).slice(0, 400),
    });
  }

  const choice = choices[0] as Record<string, unknown>;
  const rawMessage = choice.message as ChatMessage | undefined;
  if (!rawMessage || typeof rawMessage !== "object") {
    throw new LlmError({
      code: "empty_response",
      message: "LLM response missing choices[0].message",
      requestId,
    });
  }

  // Normalize null tool_calls from some gateways
  const message: ChatMessage = {
    role: "assistant",
    content: rawMessage.content ?? null,
    ...(Array.isArray(rawMessage.tool_calls) && rawMessage.tool_calls.length > 0
      ? { tool_calls: rawMessage.tool_calls }
      : {}),
    ...(rawMessage.reasoning_content
      ? { reasoning_content: rawMessage.reasoning_content }
      : {}),
  };

  return {
    message,
    finishReason: (choice.finish_reason as ChatResult["finishReason"]) ?? null,
    usage: obj.usage as ChatResult["usage"],
    model: typeof obj.model === "string" ? obj.model : undefined,
    id: typeof obj.id === "string" ? obj.id : undefined,
    requestId,
  };
}

function mergeTimeoutSignal(
  outer: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; clear: () => void } {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: outer, clear: () => undefined };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  outer?.addEventListener("abort", onAbort);

  if (outer?.aborted) controller.abort();

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(LlmError.aborted());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(LlmError.aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw LlmError.aborted();
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (LlmError.isLlmError(err) && err.code === "aborted")
  );
}
