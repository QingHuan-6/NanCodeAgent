/**
 * LLM-backed conversation compaction.
 * Cut points never split assistant.tool_calls from their tool results.
 */

import { getTodos, summarizeTodos } from "../session/todo.js";
import type { ChatMessage } from "../llm/types.js";
import type { LlmChatPort } from "./types.js";
import {
  estimateMessagesChars,
  groupMessageBlocks,
  pruneMessagesForContext,
} from "./context.js";

export interface CompactPreparation {
  system: ChatMessage[];
  /** Blocks to summarize (older history). */
  toSummarize: ChatMessage[];
  /** Recent blocks kept verbatim. */
  toKeep: ChatMessage[];
  charsSummarized: number;
  charsKept: number;
}

export interface CompactOptions {
  /** Approx chars of recent history to keep verbatim (default 20_000). */
  keepRecentChars?: number;
  /** Extra guidance for the summarizer, e.g. "focus on auth". */
  customInstructions?: string;
  /** Session id — open todos are injected into the summary prompt. */
  sessionId?: string;
  signal?: AbortSignal;
  /** Skip LLM and only prune (used as fallback). */
  pruneOnly?: boolean;
  /** Soft prune budget when falling back (default 40_000). */
  pruneMaxChars?: number;
}

export interface CompactResult {
  messages: ChatMessage[];
  removed: number;
  summarized: boolean;
  summaryChars: number;
  mode: "llm" | "prune" | "noop";
}

const DEFAULT_KEEP_RECENT = 20_000;
const MAX_SUMMARY_INPUT_CHARS = 100_000;
const MAX_SUMMARY_OUTPUT_HINT = 4_000;

/**
 * Split non-system history into summarize vs keep using block-safe cut points.
 * Walks blocks from newest until keepRecentChars is reached; older blocks are summarized.
 */
export function prepareCompact(
  messages: ChatMessage[],
  keepRecentChars = DEFAULT_KEEP_RECENT,
): CompactPreparation | null {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length === 0) return null;

  const blocks = groupMessageBlocks(rest);
  if (blocks.length < 2) return null;

  let accumulated = 0;
  let firstKept = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    accumulated += estimateMessagesChars(blocks[i]!);
    firstKept = i;
    if (accumulated >= keepRecentChars) {
      break;
    }
  }

  // Entire history fits in the keep budget — nothing to summarize.
  if (firstKept === 0) return null;

  const toSummarize = blocks.slice(0, firstKept).flat();
  const toKeep = blocks.slice(firstKept).flat();
  if (toSummarize.length === 0 || toKeep.length === 0) return null;

  return {
    system,
    toSummarize,
    toKeep,
    charsSummarized: estimateMessagesChars(toSummarize),
    charsKept: estimateMessagesChars(toKeep),
  };
}

/** Render transcript for the summarizer (truncated). */
export function formatTranscriptForSummary(messages: ChatMessage[]): string {
  const parts: string[] = [];
  let total = 0;
  for (const m of messages) {
    let chunk = "";
    if (m.role === "user") {
      chunk = `USER:\n${m.content ?? ""}\n`;
    } else if (m.role === "assistant") {
      const tools = m.tool_calls
        ?.map(
          (c) =>
            `  tool_call ${c.function.name}(${clip(c.function.arguments, 200)})`,
        )
        .join("\n");
      chunk = `ASSISTANT:\n${m.content ?? ""}${tools ? `\n${tools}` : ""}\n`;
    } else if (m.role === "tool") {
      chunk = `TOOL_RESULT id=${m.tool_call_id}:\n${clip(m.content ?? "", 1_500)}\n`;
    } else {
      chunk = `${m.role.toUpperCase()}:\n${clip(m.content ?? "", 800)}\n`;
    }
    if (total + chunk.length > MAX_SUMMARY_INPUT_CHARS) {
      parts.push("\n…[earlier transcript truncated for summarizer input]…\n");
      break;
    }
    parts.push(chunk);
    total += chunk.length;
  }
  return parts.join("\n");
}

export function extractRecentPaths(messages: ChatMessage[], limit = 8): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && paths.length < limit; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.tool_calls) {
      for (const call of m.tool_calls) {
        try {
          const args = JSON.parse(call.function.arguments || "{}") as Record<
            string,
            unknown
          >;
          const p = typeof args.path === "string" ? args.path : null;
          if (p && !seen.has(p)) {
            seen.add(p);
            paths.push(p);
          }
        } catch {
          // ignore
        }
      }
    }
  }
  return paths;
}

export function buildCompactPrompt(
  transcript: string,
  options: {
    customInstructions?: string;
    todosNote?: string;
    recentPaths?: string[];
  } = {},
): ChatMessage[] {
  const rules = [
    "You are compressing a coding-agent conversation for continuity.",
    "Write a dense summary the next agent turn can use to continue the work.",
    "Preserve: user goals, decisions made, unfinished work, key file paths, commands run, failures and fixes.",
    "Drop: raw file dumps, repetitive tool noise, chit-chat.",
    "Use short bullet sections. No preamble.",
  ];
  if (options.customInstructions?.trim()) {
    rules.push(`Extra focus: ${options.customInstructions.trim()}`);
  }
  if (options.todosNote) {
    rules.push(`Open todos at compact time:\n${options.todosNote}`);
  }
  if (options.recentPaths?.length) {
    rules.push(
      `Recently touched paths (may re-read if needed): ${options.recentPaths.join(", ")}`,
    );
  }

  return [
    { role: "system", content: rules.join("\n") },
    {
      role: "user",
      content: `Summarize this transcript:\n\n${transcript}`,
    },
  ];
}

export function buildPostCompactMessages(
  system: ChatMessage[],
  summary: string,
  toKeep: ChatMessage[],
  recentPaths: string[] = [],
): ChatMessage[] {
  const pathNote =
    recentPaths.length > 0
      ? `\n\nRecently touched paths (re-read with read_file if needed):\n${recentPaths.map((p) => `- ${p}`).join("\n")}`
      : "";

  const summaryMsg: ChatMessage = {
    role: "user",
    content: `<COMPACT_SUMMARY>\n${summary.trim()}${pathNote}\n</COMPACT_SUMMARY>\n\nContinue from this summary and the recent messages below.`,
  };

  return [...system, summaryMsg, ...toKeep];
}

/**
 * Run LLM compact (or prune fallback). Does not mutate caller arrays.
 */
export async function compactMessages(
  messages: ChatMessage[],
  llm: LlmChatPort,
  options: CompactOptions = {},
): Promise<CompactResult> {
  const before = messages.length;
  const keepRecent = options.keepRecentChars ?? DEFAULT_KEEP_RECENT;

  if (options.pruneOnly) {
    const next = pruneMessagesForContext(messages, {
      maxChars: options.pruneMaxChars ?? 40_000,
      preserveRecentBlocks: 6,
    });
    return {
      messages: next,
      removed: Math.max(0, before - next.length),
      summarized: false,
      summaryChars: 0,
      mode: next.length === before ? "noop" : "prune",
    };
  }

  const prep = prepareCompact(messages, keepRecent);
  if (!prep) {
    return {
      messages: messages.slice(),
      removed: 0,
      summarized: false,
      summaryChars: 0,
      mode: "noop",
    };
  }

  try {
    const transcript = formatTranscriptForSummary(prep.toSummarize);
    const todos = options.sessionId
      ? getTodos(options.sessionId)
      : [];
    const openTodos = todos.filter(
      (t) => t.status === "pending" || t.status === "in_progress",
    );
    const todosNote =
      openTodos.length > 0
        ? `${summarizeTodos(todos)}\n${openTodos.map((t) => `- [${t.status}] ${t.content}`).join("\n")}`
        : undefined;
    const recentPaths = extractRecentPaths([
      ...prep.toSummarize,
      ...prep.toKeep,
    ]);

    const prompt = buildCompactPrompt(transcript, {
      customInstructions: options.customInstructions,
      todosNote,
      recentPaths,
    });

    const reply = await llm.chat(prompt, undefined, {
      signal: options.signal,
      maxTokens: MAX_SUMMARY_OUTPUT_HINT,
    });

    const summary =
      (typeof reply.content === "string" && reply.content.trim()) ||
      "(empty summary)";

    const next = buildPostCompactMessages(
      prep.system,
      summary,
      prep.toKeep,
      recentPaths,
    );

    return {
      messages: next,
      removed: Math.max(0, before - next.length),
      summarized: true,
      summaryChars: summary.length,
      mode: "llm",
    };
  } catch {
    const next = pruneMessagesForContext(messages, {
      maxChars: options.pruneMaxChars ?? 40_000,
      preserveRecentBlocks: 6,
    });
    return {
      messages: next,
      removed: Math.max(0, before - next.length),
      summarized: false,
      summaryChars: 0,
      mode: "prune",
    };
  }
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
