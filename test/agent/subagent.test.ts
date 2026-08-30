import { afterEach, describe, expect, it } from "vitest";
import { runAgentLoop } from "../../src/agent/loop.js";
import {
  clearSubagentChildren,
  runSubagent,
} from "../../src/agent/subagent.js";
import type { AgentEvent } from "../../src/agent/events.js";
import { Session } from "../../src/session/session.js";
import {
  createDefaultRegistry,
  createPlanRegistry,
} from "../../src/tools/index.js";
import { createSubagentRegistry } from "../../src/tools/subagent-registry.js";
import { taskTool } from "../../src/tools/task.js";
import {
  assistantText,
  assistantToolCall,
  ScriptedLlm,
} from "../utils/scripted-llm.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";
import fs from "node:fs";
import path from "node:path";

afterEach(() => {
  clearSubagentChildren();
});

describe("subagent registries", () => {
  it("parent registries expose task; children do not", () => {
    expect(createDefaultRegistry().has("task")).toBe(true);
    expect(createPlanRegistry().has("task")).toBe(true);
    expect(createSubagentRegistry("explorer").has("task")).toBe(false);
    expect(createSubagentRegistry("worker").has("task")).toBe(false);
    expect(createSubagentRegistry("explorer").has("write_file")).toBe(false);
    expect(createSubagentRegistry("worker").has("write_file")).toBe(true);
  });
});

describe("task tool / subagents", () => {
  it("runs an explorer child and returns task_result to the parent", async () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, "README.md"), "# Hello\n", "utf8");
      const llm = new ScriptedLlm([
        assistantToolCall("t1", "task", {
          description: "Read readme",
          prompt: "Read README.md and summarize in one line.",
          subagent_type: "explorer",
        }),
        // child
        assistantToolCall("c1", "read_file", { path: "README.md" }),
        assistantText("README is a Hello title."),
        // parent
        assistantText("Child summarized README."),
      ]);
      const childToolEvents: string[] = [];

      const result = await runAgentLoop("investigate", {
        llm,
        tools: createDefaultRegistry(),
        session: new Session(),
        workspace: dir,
        maxTurns: 8,
        onEvent: (e: AgentEvent) => {
          if (e.type === "tool_execution_start" && e.toolName.startsWith("explorer.")) {
            childToolEvents.push(e.toolName);
          }
        },
      });

      expect(result.stopReason).toBe("completed");
      expect(result.finalText).toBe("Child summarized README.");
      expect(llm.calls.length).toBe(4);
      const toolMsg = llm.calls[3]!.messages.find((m) => m.role === "tool");
      expect(String(toolMsg?.content ?? "")).toContain("<task_result>");
      expect(String(toolMsg?.content ?? "")).toContain("README is a Hello title.");
      expect(childToolEvents).toContain("explorer.read_file");
    } finally {
      removeTempDir(dir);
    }
  });

  it("resumes a child with task_id", async () => {
    const dir = createTempDir();
    try {
      const llm = new ScriptedLlm([
        assistantText("alpha"),
        assistantText("beta"),
      ]);
      const first = await runSubagent({
        prompt: "Say alpha only.",
        description: "First pass",
        subagentType: "explorer",
        workspace: dir,
        llm,
        depth: 0,
        maxDepth: 1,
        forkTurns: "none",
      });
      expect(first.finalText).toContain("alpha");

      const second = await runSubagent({
        prompt: "Say beta only.",
        description: "Follow up",
        subagentType: "explorer",
        taskId: first.taskId,
        workspace: dir,
        llm,
        depth: 0,
        maxDepth: 1,
      });
      expect(second.taskId).toBe(first.taskId);
      expect(second.finalText).toContain("beta");
      // Second call should see prior turns in the child session.
      expect(llm.calls[1]!.messages.some((m) => m.role === "assistant")).toBe(
        true,
      );
      expect(
        llm.calls[1]!.messages.filter((m) => m.role === "user").length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      removeTempDir(dir);
    }
  });

  it("forks parent history into a new child by default", async () => {
    const dir = createTempDir();
    try {
      const llm = new ScriptedLlm([assistantText("used prior context")]);
      const parentMessages = [
        { role: "user" as const, content: "earlier: remember TOKEN_X" },
        { role: "assistant" as const, content: "ok I remember TOKEN_X" },
        {
          role: "assistant" as const,
          content: null,
          tool_calls: [
            {
              id: "spawn",
              type: "function" as const,
              function: {
                name: "task",
                arguments: "{}",
              },
            },
          ],
        },
      ];

      const result = await runSubagent({
        prompt: "What token did we remember?",
        description: "Check fork",
        subagentType: "explorer",
        workspace: dir,
        llm,
        depth: 0,
        maxDepth: 1,
        parentMessages,
        // default forkTurns = all
      });

      expect(result.forkedMessages).toBe(2);
      expect(result.finalText).toContain("used prior context");
      const childMsgs = llm.calls[0]!.messages;
      expect(
        childMsgs.some(
          (m) => m.role === "user" && String(m.content).includes("TOKEN_X"),
        ),
      ).toBe(true);
      // Open spawn assistant must not be copied.
      expect(
        childMsgs.some(
          (m) => m.role === "assistant" && m.tool_calls?.length,
        ),
      ).toBe(false);
    } finally {
      removeTempDir(dir);
    }
  });

  it("worker child can write files", async () => {
    const dir = createTempDir();
    try {
      const llm = new ScriptedLlm([
        assistantToolCall("t1", "task", {
          description: "Write note",
          prompt: "Write hi to note.txt",
          subagent_type: "worker",
          fork_turns: "none",
        }),
        assistantToolCall("c1", "write_file", {
          path: "note.txt",
          content: "hi\n",
        }),
        assistantText("wrote note.txt"),
        assistantText("ok"),
      ]);

      const result = await runAgentLoop("write via child", {
        llm,
        tools: createDefaultRegistry(),
        session: new Session(),
        workspace: dir,
        maxTurns: 8,
      });

      expect(result.stopReason).toBe("completed");
      expect(fs.readFileSync(path.join(dir, "note.txt"), "utf8")).toBe("hi\n");
    } finally {
      removeTempDir(dir);
    }
  });

  it("rejects worker task in plan mode", async () => {
    const dir = createTempDir();
    try {
      await expect(
        taskTool.execute(
          {
            description: "mutate",
            prompt: "write something",
            subagent_type: "worker",
          },
          {
            workspace: dir,
            agent: {
              llm: new ScriptedLlm([]),
              mode: "plan",
            },
          },
        ),
      ).rejects.toThrow(/Plan mode|explorer/);
    } finally {
      removeTempDir(dir);
    }
  });

  it("enforces depth limit via runSubagent", async () => {
    const dir = createTempDir();
    try {
      await expect(
        runSubagent({
          prompt: "x",
          description: "nested",
          subagentType: "explorer",
          workspace: dir,
          llm: new ScriptedLlm([]),
          depth: 1,
          maxDepth: 1,
        }),
      ).rejects.toThrow(/depth limit/i);
    } finally {
      removeTempDir(dir);
    }
  });
});
