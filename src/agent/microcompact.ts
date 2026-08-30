/**
 * Microcompact — Claude-style layer: clear bulky old tool results
 * while keeping assistant↔tool structure (tool_call_id intact).
 *
 * Projection only (returns a copy). Session JSONL stays full until /compact.
 */

import type { ChatMessage } from "../llm/types.js";
import { groupMessageBlocks } from "./context.js";

export interface MicrocompactOptions {
  /** Trailing blocks left untouched (default 8). */
  preserveRecentBlocks?: number;
  /** Stub tool bodies longer than this (default 800 chars). */
  maxToolChars?: number;
  /**
   * Truncate old assistant text (no tool_calls) longer than this.
   * 0 disables (default 2_000).
   */
  maxAssistantChars?: number;
}

export interface MicrocompactStats {
  toolStubbed: number;
  assistantTrimmed: number;
}

/**
 * Return a copy with old oversized tool/assistant payloads stubbed.
 */
export function microcompactMessages(
  messages: ChatMessage[],
  options: MicrocompactOptions = {},
): { messages: ChatMessage[]; stats: MicrocompactStats } {
  const preserveRecentBlocks = options.preserveRecentBlocks ?? 8;
  const maxToolChars = options.maxToolChars ?? 800;
  const maxAssistantChars = options.maxAssistantChars ?? 2_000;

  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length === 0) {
    return {
      messages: messages.slice(),
      stats: { toolStubbed: 0, assistantTrimmed: 0 },
    };
  }

  const blocks = groupMessageBlocks(rest);
  const cut = Math.max(0, blocks.length - preserveRecentBlocks);
  let toolStubbed = 0;
  let assistantTrimmed = 0;

  const outBlocks = blocks.map((block, bi) => {
    if (bi >= cut) {
      return block.map((m) => ({ ...m }));
    }
    return block.map((m) => {
      if (m.role === "tool" && (m.content?.length ?? 0) > maxToolChars) {
        toolStubbed += 1;
        const n = m.content!.length;
        return {
          ...m,
          content: `[tool result cleared by microcompact · ${n} chars · id=${m.tool_call_id ?? "?"}. Re-run the tool or read .nan/tool-output if needed.]`,
        };
      }
      if (
        maxAssistantChars > 0 &&
        m.role === "assistant" &&
        !m.tool_calls?.length &&
        typeof m.content === "string" &&
        m.content.length > maxAssistantChars
      ) {
        assistantTrimmed += 1;
        return {
          ...m,
          content: `${m.content.slice(0, maxAssistantChars)}\n…[assistant text microcompacted]`,
        };
      }
      return { ...m };
    });
  });

  return {
    messages: [...system.map((m) => ({ ...m })), ...outBlocks.flat()],
    stats: { toolStubbed, assistantTrimmed },
  };
}
