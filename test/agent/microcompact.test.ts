import { describe, expect, it } from "vitest";
import { applyContextLayers } from "../../src/agent/context.js";
import { microcompactMessages } from "../../src/agent/microcompact.js";
import type { ChatMessage } from "../../src/llm/types.js";

function toolPair(id: string, body: string): ChatMessage[] {
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: id, content: body },
  ];
}

describe("microcompact", () => {
  it("stubs old tool results but keeps recent ones and tool_call_id", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u0" },
      ...toolPair("old", "X".repeat(2_000)),
      { role: "user", content: "u1" },
      ...toolPair("mid", "Y".repeat(2_000)),
      { role: "user", content: "u2" },
      ...toolPair("new", "Z".repeat(2_000)),
      { role: "assistant", content: "done" },
    ];

    const { messages: out, stats } = microcompactMessages(messages, {
      preserveRecentBlocks: 3,
      maxToolChars: 100,
    });

    expect(stats.toolStubbed).toBeGreaterThan(0);
    const tools = out.filter((m) => m.role === "tool");
    const old = tools.find((m) => m.tool_call_id === "old");
    const recent = tools.find((m) => m.tool_call_id === "new");
    expect(old?.content).toMatch(/microcompact/);
    expect(recent?.content?.startsWith("Z")).toBe(true);
    expect(old?.tool_call_id).toBe("old");
  });

  it("layered transform microcompacts then can prune", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "old " + "a".repeat(500) },
      ...toolPair("t1", "body " + "b".repeat(3_000)),
      { role: "user", content: "keep" },
      { role: "assistant", content: "ok" },
    ];
    const layered = applyContextLayers(messages, {
      maxChars: 200_000,
      microcompact: { preserveRecentBlocks: 2, maxToolChars: 200 },
    });
    const tool = layered.find((m) => m.role === "tool");
    expect(tool?.content).toMatch(/microcompact/);
  });
});
