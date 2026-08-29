import type { LlmClient } from "../llm/client.js";
import type { ChatMessage, ToolCall } from "../llm/types.js";
import { checkPermission } from "../permissions.js";
import type { Session } from "../session/session.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentEventHandler } from "./events.js";
import { noopEvents } from "./events.js";
import { buildSystemPrompt } from "./prompt.js";

export interface AgentLoopOptions {
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
  workspace: string;
  maxTurns: number;
  onEvent?: AgentEventHandler;
  /** When permission returns "ask", call this. Default: deny. */
  askPermission?: (reason: string, toolName: string) => Promise<boolean>;
}

export interface AgentLoopResult {
  finalText: string;
  turns: number;
  stopReason: string;
}

/**
 * Core harness loop (Pi / Claude-style):
 * messages → LLM → tool_calls? → local execute → append results → repeat
 */
export async function runAgentLoop(
  task: string,
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const onEvent = options.onEvent ?? noopEvents();
  const ask =
    options.askPermission ??
    (async () => {
      return false;
    });

  onEvent({ type: "agent_start", task });

  if (options.session.getMessages().length === 0) {
    options.session.append({
      role: "system",
      content: buildSystemPrompt(options.workspace),
    });
  }
  options.session.append({ role: "user", content: task });

  let lastText = "";
  let consecutiveSameTool = 0;
  let lastToolSignature = "";

  for (let turn = 1; turn <= options.maxTurns; turn++) {
    onEvent({ type: "turn_start", turn });

    const assistant = await options.llm.chat(
      options.session.getMessages(),
      options.tools.toOpenAITools(),
    );
    options.session.append(assistant);

    if (assistant.content) {
      lastText = assistant.content;
      onEvent({ type: "assistant_text", text: assistant.content });
    }

    const toolCalls = assistant.tool_calls ?? [];
    if (toolCalls.length === 0) {
      onEvent({ type: "agent_end", reason: "no_tool_calls" });
      return { finalText: lastText, turns: turn, stopReason: "no_tool_calls" };
    }

    for (const call of toolCalls) {
      const { name, args, signature } = parseToolCall(call);
      if (signature === lastToolSignature) {
        consecutiveSameTool += 1;
      } else {
        consecutiveSameTool = 1;
        lastToolSignature = signature;
      }
      if (consecutiveSameTool >= 3) {
        const msg =
          "Stopped: the same tool was called with the same arguments 3 times in a row (doom loop).";
        onEvent({ type: "agent_end", reason: "doom_loop" });
        return { finalText: msg, turns: turn, stopReason: "doom_loop" };
      }

      const perm = checkPermission({
        toolName: name,
        args,
        workspace: options.workspace,
      });
      onEvent({
        type: "permission",
        name,
        decision: perm.decision,
        reason: perm.reason,
      });

      if (perm.decision === "deny") {
        options.session.append({
          role: "tool",
          tool_call_id: call.id,
          content: `Permission denied: ${perm.reason ?? "blocked"}`,
        });
        continue;
      }

      if (perm.decision === "ask") {
        const allowed = await ask(perm.reason ?? "Confirm tool use", name);
        if (!allowed) {
          options.session.append({
            role: "tool",
            tool_call_id: call.id,
            content: `Permission denied by user: ${perm.reason ?? "ask rejected"}`,
          });
          continue;
        }
      }

      onEvent({ type: "tool_start", name, args });
      const result = await options.tools.run(name, args, {
        workspace: options.workspace,
      });
      onEvent({ type: "tool_end", name, output: result.output });

      options.session.append({
        role: "tool",
        tool_call_id: call.id,
        content: result.output,
      });

      if (result.terminate) {
        onEvent({ type: "agent_end", reason: "tool_terminate" });
        return {
          finalText: lastText || result.output,
          turns: turn,
          stopReason: "tool_terminate",
        };
      }
    }
  }

  onEvent({ type: "agent_end", reason: "max_turns" });
  return {
    finalText: lastText || "Stopped: max turns reached.",
    turns: options.maxTurns,
    stopReason: "max_turns",
  };
}

function parseToolCall(call: ToolCall): {
  name: string;
  args: Record<string, unknown>;
  signature: string;
} {
  const name = call.function.name;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
  } catch {
    args = { _raw: call.function.arguments };
  }
  return { name, args, signature: `${name}:${JSON.stringify(args)}` };
}
