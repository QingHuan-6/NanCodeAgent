/**
 * Context window helpers — prune without splitting assistant tool_calls
 * from their following tool results (claw / Pi safety rule).
 */

import type { ChatMessage } from "../llm/types.js";

export interface PruneOptions {
  /** Soft char budget for non-system messages (default ~120k). */
  maxChars?: number;
  /** Always keep at least this many trailing blocks (default 4). */
  preserveRecentBlocks?: number;
}

/** Rough size estimate — chars, not tokenizer tokens. */
export function estimateMessageChars(message: ChatMessage): number {
  let n = message.content?.length ?? 0;
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      n += call.function.name.length + (call.function.arguments?.length ?? 0) + 24;
    }
  }
  if (message.tool_call_id) n += message.tool_call_id.length + 8;
  if (message.reasoning_content) n += message.reasoning_content.length;
  return n;
}

export function estimateMessagesChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageChars(m), 0);
}

/**
 * Group transcript into blocks that must stay together:
 * - system (handled separately)
 * - user
 * - assistant (+ immediately following tool results for its tool_calls)
 */
export function groupMessageBlocks(messages: ChatMessage[]): ChatMessage[][] {
  const blocks: ChatMessage[][] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;
    if (msg.role === "assistant" && (msg.tool_calls?.length ?? 0) > 0) {
      const block: ChatMessage[] = [msg];
      i += 1;
      const needed = new Set(msg.tool_calls!.map((c) => c.id));
      while (i < messages.length && needed.size > 0) {
        const next = messages[i]!;
        if (next.role === "tool" && next.tool_call_id && needed.has(next.tool_call_id)) {
          block.push(next);
          needed.delete(next.tool_call_id);
          i += 1;
        } else {
          break;
        }
      }
      blocks.push(block);
      continue;
    }
    blocks.push([msg]);
    i += 1;
  }
  return blocks;
}

/**
 * Return a copy of messages pruned to fit maxChars.
 * Does not mutate the session — safe for transformContext.
 */
export function pruneMessagesForContext(
  messages: ChatMessage[],
  options: PruneOptions = {},
): ChatMessage[] {
  const maxChars = options.maxChars ?? 120_000;
  const preserveRecentBlocks = options.preserveRecentBlocks ?? 4;

  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (estimateMessagesChars(rest) <= maxChars) {
    return messages.slice();
  }

  const blocks = groupMessageBlocks(rest);
  const kept: ChatMessage[][] = [];
  let size = 0;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;
    const blockSize = estimateMessagesChars(block);
    const mustKeep = kept.length < preserveRecentBlocks;
    if (!mustKeep && kept.length > 0 && size + blockSize > maxChars) {
      break;
    }
    kept.unshift(block);
    size += blockSize;
  }

  if (kept.length >= blocks.length) {
    return messages.slice();
  }

  const note: ChatMessage = {
    role: "user",
    content:
      "[Earlier conversation was truncated to fit the context window. Recent messages are preserved verbatim.]",
  };

  return [...system, note, ...kept.flat()];
}

/** Default transformContext used by AgentRuntime / CLI. */
export function createDefaultTransformContext(
  options: PruneOptions = {},
): (messages: ChatMessage[]) => ChatMessage[] {
  return (messages) => pruneMessagesForContext(messages, options);
}

/**
 * In-place compact: replace dropped head with a single note in the session copy.
 * Returns how many messages were removed from the middle/head.
 */
export function compactMessagesInPlace(
  messages: ChatMessage[],
  options: PruneOptions = {},
): { messages: ChatMessage[]; removed: number } {
  const before = messages.length;
  const next = pruneMessagesForContext(messages, {
    maxChars: options.maxChars ?? 40_000,
    preserveRecentBlocks: options.preserveRecentBlocks ?? 6,
  });
  return { messages: next, removed: Math.max(0, before - next.length) };
}
