/**
 * Claude-style context size estimation:
 * API usage as anchor + rough chars/4 (JSON denser chars/2) for newer messages.
 */

import type { ChatMessage, Usage } from "../llm/types.js";

export interface ContextWindowConfig {
  /** Model context window in tokens (default 128_000). */
  windowTokens: number;
  /** Reserve for the next completion (default 8_192). */
  outputReserveTokens: number;
}

export interface ContextEstimate {
  estimatedTokens: number;
  windowTokens: number;
  outputReserveTokens: number;
  /** Tokens available for prompt history roughly. */
  promptBudgetTokens: number;
  usedRatio: number;
  source: "usage+rough" | "rough";
  lastUsage: Usage | null;
}

const DEFAULT_WINDOW = 128_000;
const DEFAULT_RESERVE = 8_192;

export function resolveContextWindowConfig(env = process.env): ContextWindowConfig {
  const windowTokens =
    positiveInt(env.NAN_CONTEXT_TOKENS) ?? DEFAULT_WINDOW;
  const outputReserveTokens =
    positiveInt(env.NAN_CONTEXT_RESERVE) ?? DEFAULT_RESERVE;
  return { windowTokens, outputReserveTokens };
}

/**
 * Rough token estimate without a tokenizer (Claude-style).
 * Dense JSON / tool args use a more conservative divisor.
 */
export function roughTokenEstimate(text: string): number {
  if (!text) return 0;
  const dense = looksDense(text);
  const div = dense ? 2 : 4;
  return Math.max(1, Math.ceil(text.length / div));
}

export function roughTokensForMessage(message: ChatMessage): number {
  let n = 4; // role overhead
  if (typeof message.content === "string") {
    n += roughTokenEstimate(message.content);
  }
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      n += roughTokenEstimate(call.function.name);
      n += roughTokenEstimate(call.function.arguments || "");
      n += 8;
    }
  }
  if (message.tool_call_id) n += 4;
  if (message.reasoning_content) {
    n += roughTokenEstimate(message.reasoning_content);
  }
  return n;
}

export function roughTokensForMessages(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + roughTokensForMessage(m), 0);
}

/**
 * Estimate tokens that will be sent on the next LLM call.
 *
 * If `lastUsage` was recorded for the assistant at `usageAssistantIndex`,
 * use prompt_tokens + completion_tokens as anchor and rough-count messages
 * after that assistant (tool results, new user turns, …).
 */
export function estimateContextTokens(
  messages: ChatMessage[],
  lastUsage: Usage | null,
  usageAssistantIndex: number | null,
): { tokens: number; source: ContextEstimate["source"] } {
  const nonSystem = messages.filter((m) => m.role !== "system");
  if (
    lastUsage &&
    usageAssistantIndex != null &&
    usageAssistantIndex >= 0 &&
    usageAssistantIndex < messages.length
  ) {
    const after = messages.slice(usageAssistantIndex + 1);
    const tokens =
      (lastUsage.prompt_tokens || 0) +
      (lastUsage.completion_tokens || 0) +
      roughTokensForMessages(after);
    return { tokens, source: "usage+rough" };
  }
  return {
    tokens: roughTokensForMessages(nonSystem.length ? nonSystem : messages),
    source: "rough",
  };
}

export function buildContextEstimate(
  messages: ChatMessage[],
  lastUsage: Usage | null,
  usageAssistantIndex: number | null,
  config?: Partial<ContextWindowConfig>,
): ContextEstimate {
  const windowTokens = config?.windowTokens ?? DEFAULT_WINDOW;
  const outputReserveTokens = config?.outputReserveTokens ?? DEFAULT_RESERVE;
  const promptBudgetTokens = Math.max(1, windowTokens - outputReserveTokens);
  const { tokens, source } = estimateContextTokens(
    messages,
    lastUsage,
    usageAssistantIndex,
  );
  return {
    estimatedTokens: tokens,
    windowTokens,
    outputReserveTokens,
    promptBudgetTokens,
    usedRatio: Math.min(1, tokens / promptBudgetTokens),
    source,
    lastUsage,
  };
}

function looksDense(text: string): boolean {
  if (text.length < 40) return false;
  if (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
    return true;
  }
  const sample = text.slice(0, 400);
  const symbols = (sample.match(/[{}\[\]",:]/g) || []).length;
  return symbols / sample.length > 0.12;
}

function positiveInt(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function formatContextLine(est: ContextEstimate): string {
  const pct = Math.round(est.usedRatio * 100);
  return `ctx ~${pct}% (${est.estimatedTokens}/${est.promptBudgetTokens} tok, ${est.source})`;
}

export function formatContextBreakdown(
  est: ContextEstimate,
  messages: ChatMessage[],
): string {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const lines = [
    formatContextLine(est),
    `  window:   ${est.windowTokens} tok (reserve ${est.outputReserveTokens})`,
    `  system:   ~${roughTokensForMessages(system)} tok`,
    `  history:  ~${roughTokensForMessages(rest)} tok (full rough)`,
  ];
  if (est.lastUsage) {
    lines.push(
      `  last API: prompt ${est.lastUsage.prompt_tokens} + completion ${est.lastUsage.completion_tokens}`,
    );
  } else {
    lines.push("  last API: (none — rough only until first usage)");
  }
  return lines.join("\n");
}
