/**
 * Codex-style parent → child context fork (copy completed turns, not a live share).
 */

import type { ChatMessage } from "../llm/types.js";

/** `"all"` full history · `"none"` clean spawn · number = last N user turns. */
export type ForkTurns = "all" | "none" | number;

export function parseForkTurns(raw: unknown): ForkTurns {
  if (raw === undefined || raw === null || raw === "") return "all";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "all" || s === "none") return s;
    if (/^\d+$/.test(s)) return Math.max(0, Number(s));
  }
  throw new Error(
    'fork_turns must be "all", "none", or a non-negative integer (recent user turns)',
  );
}

/**
 * Build the conversation prefix a child should inherit.
 * Drops system (child gets its own) and any incomplete trailing tool round
 * (typically the parent assistant message that is currently calling `task`).
 */
export function forkParentMessages(
  parent: ChatMessage[],
  forkTurns: ForkTurns,
): ChatMessage[] {
  if (forkTurns === "none" || forkTurns === 0) return [];

  let msgs = structuredClone(parent).filter((m) => m.role !== "system");
  msgs = dropIncompleteToolRounds(msgs);

  if (forkTurns === "all") return msgs;

  const n = forkTurns;
  const userIndices: number[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i]!.role === "user") userIndices.push(i);
  }
  if (userIndices.length <= n) return msgs;
  const start = userIndices[userIndices.length - n]!;
  return msgs.slice(start);
}

function dropIncompleteToolRounds(msgs: ChatMessage[]): ChatMessage[] {
  let out = msgs;
  // Peel trailing open assistant(tool_calls) with missing tool results.
  for (;;) {
    const cut = findOpenToolAssistantIndex(out);
    if (cut < 0) break;
    out = out.slice(0, cut);
  }
  return out;
}

/** Index of last incomplete assistant tool-call message, or -1. */
function findOpenToolAssistantIndex(msgs: ChatMessage[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.role !== "assistant" || !m.tool_calls?.length) continue;
    const pending = new Set(m.tool_calls.map((t) => t.id));
    for (let j = i + 1; j < msgs.length; j++) {
      const t = msgs[j]!;
      if (t.role === "user" || t.role === "assistant") break;
      if (t.role === "tool" && t.tool_call_id) pending.delete(t.tool_call_id);
    }
    if (pending.size > 0) return i;
    return -1;
  }
  return -1;
}
