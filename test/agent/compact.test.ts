import { describe, expect, it } from "vitest";
import {
  buildPostCompactMessages,
  compactMessages,
  prepareCompact,
} from "../../src/agent/compact.js";
import { groupMessageBlocks } from "../../src/agent/context.js";
import type { ChatMessage } from "../../src/llm/types.js";
import { ScriptedLlm, assistantText } from "../utils/scripted-llm.js";

function toolPair(id: string, name: string, result: string): ChatMessage[] {
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: { name, arguments: JSON.stringify({ path: `${name}.ts` }) },
        },
      ],
    },
    { role: "tool", tool_call_id: id, content: result },
  ];
}

describe("prepareCompact", () => {
  it("never puts a tool result in summarize without its assistant", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "old task " + "x".repeat(500) },
      ...toolPair("c1", "read_file", "file body " + "y".repeat(500)),
      { role: "user", content: "newer " + "z".repeat(500) },
      ...toolPair("c2", "bash", "ok"),
      { role: "assistant", content: "recent answer" },
    ];

    const prep = prepareCompact(messages, 80);
    expect(prep).not.toBeNull();
    const summarized = prep!.toSummarize;
    const toolIdx = summarized.findIndex((m) => m.role === "tool");
    if (toolIdx >= 0) {
      expect(summarized[toolIdx - 1]?.role).toBe("assistant");
      expect(summarized[toolIdx - 1]?.tool_calls?.length).toBeGreaterThan(0);
    }
    // Keep side also intact as blocks
    const keepBlocks = groupMessageBlocks(prep!.toKeep);
    for (const block of keepBlocks) {
      if (block[0]?.role === "assistant" && block[0].tool_calls?.length) {
        expect(block.some((m) => m.role === "tool")).toBe(true);
      }
    }
  });

  it("returns null when history fits keep budget", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(prepareCompact(messages, 50_000)).toBeNull();
  });
});

describe("compactMessages (LLM)", () => {
  it("replaces older history with COMPACT_SUMMARY", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are Nan." },
      { role: "user", content: "old-1 " + "a".repeat(400) },
      { role: "assistant", content: "did old work " + "b".repeat(400) },
      { role: "user", content: "old-2 " + "c".repeat(400) },
      ...toolPair("t1", "read_file", "content " + "d".repeat(300)),
      { role: "user", content: "keep me recent" },
      { role: "assistant", content: "still working" },
    ];

    const llm = new ScriptedLlm([
      assistantText(
        "Goals: finish feature\nDone: explored files\nNext: edit main",
      ),
    ]);

    const result = await compactMessages(messages, llm, {
      keepRecentChars: 100,
    });

    expect(result.mode).toBe("llm");
    expect(result.summarized).toBe(true);
    expect(result.messages[0]?.role).toBe("system");
    const summary = result.messages.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("<COMPACT_SUMMARY>"),
    );
    expect(summary).toBeTruthy();
    expect(summary!.content).toContain("Goals: finish feature");
    expect(
      result.messages.some(
        (m) => m.role === "user" && m.content === "keep me recent",
      ),
    ).toBe(true);
    expect(llm.calls).toHaveLength(1);
    // Summarizer call has no tools
    expect(llm.calls[0]!.tools).toBeUndefined();
  });

  it("falls back to prune when summarizer fails", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1 " + "x".repeat(200) },
      { role: "assistant", content: "a1 " + "y".repeat(200) },
      { role: "user", content: "u2 " + "z".repeat(200) },
      { role: "assistant", content: "a2 recent" },
    ];
    const llm = new ScriptedLlm([]); // will throw on chat
    const result = await compactMessages(messages, llm, {
      keepRecentChars: 50,
      pruneMaxChars: 80,
    });
    expect(result.mode).toBe("prune");
    expect(result.summarized).toBe(false);
  });
});

describe("buildPostCompactMessages", () => {
  it("keeps system then summary then recent", () => {
    const out = buildPostCompactMessages(
      [{ role: "system", content: "sys" }],
      "summary text",
      [{ role: "user", content: "recent" }],
      ["src/a.ts"],
    );
    expect(out).toHaveLength(3);
    expect(out[1]!.content).toContain("<COMPACT_SUMMARY>");
    expect(out[1]!.content).toContain("src/a.ts");
    expect(out[2]!.content).toBe("recent");
  });
});
