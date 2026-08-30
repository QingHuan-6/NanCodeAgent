import { describe, expect, it } from "vitest";
import { timelineFromMessages } from "../../src/cli/tui/resume-timeline.js";
import type { ChatMessage } from "../../src/llm/types.js";

describe("timelineFromMessages", () => {
  it("rebuilds user, assistant, and tool rows with outputs", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "read foo" },
      {
        role: "assistant",
        content: "I'll read it.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "read",
              arguments: JSON.stringify({ path: "foo.ts" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "export const x = 1;",
      },
      { role: "assistant", content: "Done." },
    ];

    const items = timelineFromMessages(messages);
    expect(items.map((i) => i.kind)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    const tool = items[2]!;
    expect(tool.kind).toBe("tool");
    if (tool.kind === "tool") {
      expect(tool.toolName).toBe("read");
      expect(tool.status).toBe("done");
      expect(tool.output).toContain("export const x");
      expect(tool.subject).toContain("foo");
    }
  });

  it("skips empty user/assistant content", () => {
    const items = timelineFromMessages([
      { role: "user", content: "   " },
      { role: "assistant", content: null, tool_calls: [] },
    ]);
    expect(items).toEqual([]);
  });
});
