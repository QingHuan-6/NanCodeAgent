/**
 * Typed LLM / HTTP errors with retry hints.
 */

export type LlmErrorCode =
  | "auth"
  | "rate_limit"
  | "context_length"
  | "bad_request"
  | "server"
  | "network"
  | "aborted"
  | "parse"
  | "empty_response"
  | "retries_exhausted"
  | "unknown";

export interface LlmErrorInit {
  code: LlmErrorCode;
  message: string;
  status?: number;
  requestId?: string;
  retryable?: boolean;
  /** Suggested delay from Retry-After (ms). */
  retryAfterMs?: number;
  bodySnippet?: string;
  cause?: unknown;
}

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly bodySnippet?: string;

  constructor(init: LlmErrorInit) {
    super(init.message);
    this.name = "LlmError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.retryable = init.retryable ?? false;
    this.retryAfterMs = init.retryAfterMs;
    this.bodySnippet = init.bodySnippet;
    if (init.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = init.cause;
    }
  }

  static isLlmError(err: unknown): err is LlmError {
    return err instanceof LlmError;
  }

  static aborted(message = "LLM request aborted"): LlmError {
    return new LlmError({
      code: "aborted",
      message,
      retryable: false,
    });
  }
}

const CONTEXT_MARKERS = [
  "maximum context length",
  "context window",
  "context length",
  "too many tokens",
  "prompt is too long",
  "input is too long",
  "input tokens exceed",
  "request is too large",
];

export function classifyHttpError(
  status: number,
  body: string,
  requestId?: string,
): LlmError {
  const snippet = body.slice(0, 800);
  const lower = body.toLowerCase();
  const retryAfterMs = undefined;

  if (status === 401 || status === 403) {
    return new LlmError({
      code: "auth",
      message: `LLM auth failed (${status}): ${snippet || "unauthorized"}`,
      status,
      requestId,
      retryable: false,
      bodySnippet: snippet,
    });
  }

  if (status === 429) {
    return new LlmError({
      code: "rate_limit",
      message: `LLM rate limited (429): ${snippet || "too many requests"}`,
      status,
      requestId,
      retryable: true,
      retryAfterMs,
      bodySnippet: snippet,
    });
  }

  if (status === 400 && CONTEXT_MARKERS.some((m) => lower.includes(m))) {
    return new LlmError({
      code: "context_length",
      message: `LLM context length exceeded: ${snippet}`,
      status,
      requestId,
      retryable: false,
      bodySnippet: snippet,
    });
  }

  if (status >= 400 && status < 500) {
    return new LlmError({
      code: "bad_request",
      message: `LLM bad request (${status}): ${snippet}`,
      status,
      requestId,
      retryable: false,
      bodySnippet: snippet,
    });
  }

  if (status >= 500) {
    return new LlmError({
      code: "server",
      message: `LLM server error (${status}): ${snippet}`,
      status,
      requestId,
      retryable: true,
      bodySnippet: snippet,
    });
  }

  return new LlmError({
    code: "unknown",
    message: `LLM request failed (${status}): ${snippet}`,
    status,
    requestId,
    retryable: status === 408 || status === 409,
    bodySnippet: snippet,
  });
}

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return Math.min(asInt * 1000, 120_000);
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.min(date - Date.now(), 120_000));
  }
  return undefined;
}
