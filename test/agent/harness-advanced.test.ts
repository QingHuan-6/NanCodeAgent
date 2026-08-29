import { describe, expect, it } from "vitest";
import {
  groupMessageBlocks,
  pruneMessagesForContext,
} from "../../src/agent/context.js";
import { runAgentLoop } from "../../src/agent/loop.js";
import { PendingMessageQueue } from "../../src/agent/queue.js";
import { Session } from "../../src/session/session.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ToolDefinition } from "../../src/tools/types.js";
import {
  assistantText,
  assistantToolCall,
  ScriptedLlm,
} from "../utils/scripted-llm.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";
import type { ChatMessage } from "../../src/llm/types.js";

describe("context prune", () => {
  it("does not split assistant tool_calls from tool results", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "read_file", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "ok" },
      { role: "user", content: "u2-recent" },
    ];
    const blocks = groupMessageBlocks(messages.filter((m) => m.role !== "system"));
    expect(blocks.some((b) => b.length === 2 && b[0]?.role === "assistant")).toBe(
      true,
    );

    const pruned = pruneMessagesForContext(messages, {
      maxChars: 30,
      preserveRecentBlocks: 1,
    });
    // tool result must not appear without its assistant
    const toolIdx = pruned.findIndex((m) => m.role === "tool");
    if (toolIdx >= 0) {
      expect(pruned[toolIdx - 1]?.role).toBe("assistant");
    }
  });
});

describe("PendingMessageQueue", () => {
  it("drains one-at-a-time by default", () => {
    const q = new PendingMessageQueue<string>("one-at-a-time");
    q.enqueue("a");
    q.enqueue("b");
    expect(q.drain()).toEqual(["a"]);
    expect(q.drain()).toEqual(["b"]);
    expect(q.drain()).toEqual([]);
  });

  it("drains all when mode is all", () => {
    const q = new PendingMessageQueue<string>("all");
    q.enqueue("a");
    q.enqueue("b");
    expect(q.drain()).toEqual(["a", "b"]);
  });
});

describe("parallel tools + steering", () => {
  it("runs independent tools concurrently and preserves order", async () => {
    const started: number[] = [];
    const registry = new ToolRegistry();
    const slow =
      (name: string, ms: number): ToolDefinition => ({
        name,
        description: name,
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          started.push(Date.now());
          await new Promise((r) => setTimeout(r, ms));
          return { output: name };
        },
      });
    registry.register(slow("slow_a", 120));
    registry.register(slow("slow_b", 120));

    const llm = new ScriptedLlm([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: { name: "slow_a", arguments: "{}" },
          },
          {
            id: "2",
            type: "function",
            function: { name: "slow_b", arguments: "{}" },
          },
        ],
      },
      assistantText("done"),
    ]);

    const result = await runAgentLoop("go", {
      llm,
      tools: registry,
      session: new Session(),
      workspace: process.cwd(),
      maxTurns: 5,
      toolExecution: "parallel",
    });

    expect(result.stopReason).toBe("completed");
    expect(started.length).toBe(2);
    // Both executes should start nearly together (not ~120ms apart).
    expect(Math.abs(started[0]! - started[1]!)).toBeLessThan(60);
    expect(result.finalText).toBe("done");
  });

  it("steers via getSteeringMessages after the first tool batch", async () => {
    const dir = createTempDir();
    try {
      const queue: ChatMessage[] = [];
      const steered: string[] = [];
      let toolsDone = false;

      const llm = new ScriptedLlm([
        assistantToolCall("c1", "write_file", {
          path: "a.txt",
          content: "x",
        }),
        assistantText("heard steer"),
      ]);

      const result = await runAgentLoop("start", {
        llm,
        tools: (await import("../../src/tools/index.js")).createDefaultRegistry(),
        session: new Session(),
        workspace: dir,
        maxTurns: 5,
        getSteeringMessages: async () => {
          if (!toolsDone) return [];
          if (queue.length === 0) return [];
          const msg = queue.shift()!;
          return [msg];
        },
        onEvent: (e) => {
          if (e.type === "tool_execution_end") {
            toolsDone = true;
            queue.push({ role: "user", content: "please finish" });
          }
          if (e.type === "user_message" && e.source === "steer") {
            steered.push(e.content);
          }
        },
      });

      expect(result.stopReason).toBe("completed");
      expect(result.finalText).toBe("heard steer");
      expect(steered).toContain("please finish");
      expect(llm.calls.length).toBe(2);
      const secondCallMsgs = llm.calls[1]!.messages;
      expect(
        secondCallMsgs.some(
          (m) => m.role === "user" && m.content === "please finish",
        ),
      ).toBe(true);
    } finally {
      removeTempDir(dir);
    }
  });

  it("follow-up queue continues after a text-only stop", async () => {
    let followReady = false;
    const llm = new ScriptedLlm([
      assistantText("first stop"),
      assistantText("from follow-up"),
    ]);

    const result = await runAgentLoop("hi", {
      llm,
      tools: new ToolRegistry(),
      session: new Session(),
      workspace: process.cwd(),
      maxTurns: 5,
      getFollowUpMessages: async () => {
        if (followReady) return [];
        followReady = true;
        return [{ role: "user", content: "one more thing" }];
      },
    });

    expect(result.finalText).toBe("from follow-up");
    expect(llm.calls.length).toBe(2);
  });
});

describe("continue + session resume", () => {
  it("continueAgentLoop resumes when last message is tool", async () => {
    const { continueAgentLoop } = await import("../../src/agent/loop.js");
    const dir = createTempDir();
    try {
      const session = new Session();
      session.append({ role: "system", content: "sys" });
      session.append({ role: "user", content: "write" });
      session.append(
        assistantToolCall("c1", "write_file", {
          path: "x.txt",
          content: "hi",
        }),
      );
      // Simulate tool result already written (crash mid-turn recovery)
      const { createDefaultRegistry } = await import(
        "../../src/tools/index.js"
      );
      const tools = createDefaultRegistry();
      const written = await tools.run(
        "write_file",
        { path: "x.txt", content: "hi" },
        { workspace: dir },
      );
      session.append({
        role: "tool",
        tool_call_id: "c1",
        content: written.output,
      });

      const llm = new ScriptedLlm([assistantText("recovered")]);
      const result = await continueAgentLoop({
        llm,
        tools,
        session,
        workspace: dir,
        maxTurns: 3,
      });
      expect(result.stopReason).toBe("completed");
      expect(result.finalText).toBe("recovered");
    } finally {
      removeTempDir(dir);
    }
  });

  it("loads session from jsonl", async () => {
    const dir = createTempDir();
    try {
      const s1 = new Session({ id: "sess-test", persistDir: dir });
      s1.append({ role: "user", content: "hello" });
      s1.append({ role: "assistant", content: "hi" });
      const loaded = Session.loadFromJsonl(`${dir}/sess-test.jsonl`, {
        persistDir: dir,
      });
      expect(loaded.id).toBe("sess-test");
      expect(loaded.messageCount()).toBe(2);
      expect(Session.listSessionIds(dir)).toContain("sess-test");
    } finally {
      removeTempDir(dir);
    }
  });
});
