import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../../src/agent/loop.js";
import type { AgentEvent } from "../../src/agent/events.js";
import { Session } from "../../src/session/session.js";
import { createDefaultRegistry } from "../../src/tools/index.js";
import {
  assistantText,
  assistantToolCall,
  ScriptedLlm,
} from "../utils/scripted-llm.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";

describe("agent loop", () => {
  it("completes when the model returns text without tools", async () => {
    const llm = new ScriptedLlm([assistantText("hello")]);
    const session = new Session();
    const events: AgentEvent["type"][] = [];

    const result = await runAgentLoop("hi", {
      llm,
      tools: createDefaultRegistry(),
      session,
      workspace: process.cwd(),
      maxTurns: 5,
      onEvent: (e) => events.push(e.type),
    });

    expect(result.stopReason).toBe("completed");
    expect(result.finalText).toBe("hello");
    expect(events[0]).toBe("agent_start");
    expect(events).toContain("assistant_message");
    expect(events.at(-1)).toBe("agent_end");
    expect(llm.calls).toHaveLength(1);
  });

  it("executes a tool call then finishes on the next LLM response", async () => {
    const dir = createTempDir();
    try {
      const llm = new ScriptedLlm([
        assistantToolCall("call_1", "write_file", {
          path: "out.txt",
          content: "from-agent\n",
        }),
        assistantText("wrote the file"),
      ]);
      const session = new Session();

      const result = await runAgentLoop("write out.txt", {
        llm,
        tools: createDefaultRegistry(),
        session,
        workspace: dir,
        maxTurns: 5,
      });

      expect(result.stopReason).toBe("completed");
      expect(result.finalText).toBe("wrote the file");
      expect(llm.calls).toHaveLength(2);
      expect(session.getMessages().some((m) => m.role === "tool")).toBe(true);
    } finally {
      removeTempDir(dir);
    }
  });

  it("stops on doom loop of identical tool calls", async () => {
    const dir = createTempDir();
    try {
      const same = assistantToolCall("c", "read_file", { path: "missing.txt" });
      const llm = new ScriptedLlm([same, same, same]);
      const result = await runAgentLoop("read", {
        llm,
        tools: createDefaultRegistry(),
        session: new Session(),
        workspace: dir,
        maxTurns: 10,
        doomLoopThreshold: 3,
      });
      expect(result.stopReason).toBe("doom_loop");
    } finally {
      removeTempDir(dir);
    }
  });

  it("respects maxTurns", async () => {
    const dir = createTempDir();
    try {
      const llm = new ScriptedLlm([
        assistantToolCall("a", "bash", { command: "echo 1" }),
        assistantToolCall("b", "bash", { command: "echo 2" }),
        assistantToolCall("c", "bash", { command: "echo 3" }),
      ]);
      const result = await runAgentLoop("keep going", {
        llm,
        tools: createDefaultRegistry(),
        session: new Session(),
        workspace: dir,
        maxTurns: 2,
      });
      expect(result.stopReason).toBe("max_turns");
      expect(result.turns).toBe(2);
    } finally {
      removeTempDir(dir);
    }
  });
});
