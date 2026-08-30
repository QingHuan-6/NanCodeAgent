/**
 * Rebuild TUI timeline rows from persisted session messages (resume).
 */

import type { ChatMessage } from "../../llm/types.js";
import { nextId, toolSubject, type TimelineItem } from "./types.js";

/**
 * Best-effort chronological transcript from ChatMessage history.
 * Skips system prompts; pairs tool_calls with later tool results.
 */
export function timelineFromMessages(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const toolIndexByCallId = new Map<string, number>();

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      const text =
        typeof message.content === "string" ? message.content.trim() : "";
      if (!text) continue;
      items.push({ id: nextId("user"), kind: "user", text });
      continue;
    }

    if (message.role === "assistant") {
      const content =
        typeof message.content === "string" ? message.content.trimEnd() : "";
      if (content.trim()) {
        items.push({
          id: nextId("asst"),
          kind: "assistant",
          text: content,
        });
      }
      for (const call of message.tool_calls ?? []) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }
        const id = nextId("tool");
        toolIndexByCallId.set(call.id, items.length);
        items.push({
          id,
          kind: "tool",
          toolCallId: call.id,
          toolName: call.function.name,
          subject: toolSubject(call.function.name, args),
          status: "done",
          expanded: false,
        });
      }
      continue;
    }

    if (message.role === "tool" && message.tool_call_id) {
      const idx = toolIndexByCallId.get(message.tool_call_id);
      if (idx == null) continue;
      const cur = items[idx];
      if (!cur || cur.kind !== "tool") continue;
      const output =
        typeof message.content === "string" ? message.content : "";
      items[idx] = {
        ...cur,
        output,
        status: "done",
      };
    }
  }

  return items;
}
