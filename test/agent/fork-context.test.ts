import { describe, expect, it } from "vitest";
import {
  forkParentMessages,
  parseForkTurns,
} from "../../src/agent/fork-context.js";
import type { ChatMessage } from "../../src/llm/types.js";

describe("forkParentMessages", () => {
  const base: ChatMessage[] = [
    { role: "system", content: "parent system" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_task",
          type: "function",
          function: { name: "task", arguments: "{}" },
        },
      ],
    },
  ];

  it("defaults parse to all", () => {
    expect(parseForkTurns(undefined)).toBe("all");
    expect(parseForkTurns("none")).toBe("none");
    expect(parseForkTurns("3")).toBe(3);
  });

  it("forks all completed turns and drops the open task call", () => {
    const forked = forkParentMessages(base, "all");
    expect(forked.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(forked.some((m) => m.role === "system")).toBe(false);
  });

  it("supports none and recent N user turns", () => {
    expect(forkParentMessages(base, "none")).toEqual([]);
    const recent = forkParentMessages(base, 1);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ role: "user", content: "u2" });
  });

  it("keeps completed tool rounds", () => {
    const withTool: ChatMessage[] = [
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "r1",
            type: "function",
            function: { name: "read_file", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "r1", content: "file body" },
      { role: "assistant", content: "seen it" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "t1",
            type: "function",
            function: { name: "task", arguments: "{}" },
          },
        ],
      },
    ];
    const forked = forkParentMessages(withTool, "all");
    expect(forked.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(forked[2]).toMatchObject({ content: "file body" });
  });
});
