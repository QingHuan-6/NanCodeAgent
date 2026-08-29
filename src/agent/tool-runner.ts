import type { ChatMessage, ToolCall } from "../llm/types.js";
import { checkPermission } from "../permissions.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolResult } from "../tools/types.js";
import { emitEvent, type AgentEventHandler } from "./events.js";
import type { BeforeToolCallResult, ParsedToolCall } from "./types.js";

export interface ToolBatchItem {
  call: ParsedToolCall;
  result: ToolResult;
  isError: boolean;
}

export interface RunToolBatchOptions {
  tools: ToolRegistry;
  workspace: string;
  onEvent: AgentEventHandler;
  beforeToolCall: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<BeforeToolCallResult> | BeforeToolCallResult;
  askPermission: (reason: string, toolName: string) => Promise<boolean>;
  signal?: AbortSignal;
}

/**
 * Execute one assistant tool-call batch sequentially.
 * Pi rule: early-stop follow-up LLM only if **every** finalized result has terminate=true.
 */
export async function runToolBatch(
  toolCalls: ToolCall[],
  options: RunToolBatchOptions,
): Promise<{ items: ToolBatchItem[]; terminateBatch: boolean }> {
  const items: ToolBatchItem[] = [];
  let terminateVotes = 0;

  for (const raw of toolCalls) {
    throwIfAborted(options.signal);

    const call = parseToolCall(raw);
    await emitEvent(options.onEvent, {
      type: "tool_execution_start",
      toolCallId: call.id,
      toolName: call.name,
      args: call.args,
    });

    if (call.parseError) {
      const result: ToolResult = {
        output: `Tool call arguments were invalid JSON: ${call.parseError}. Re-issue the tool with valid JSON arguments.`,
      };
      items.push({ call, result, isError: true });
      await emitToolEnd(options.onEvent, call, result.output, true);
      continue;
    }

    const gate = await options.beforeToolCall(call.name, call.args);
    await emitEvent(options.onEvent, {
      type: "permission",
      toolName: call.name,
      decision: gate.decision,
      reason: gate.reason,
    });

    let allowed = gate.decision === "allow";
    if (gate.decision === "ask") {
      allowed = await options.askPermission(
        gate.reason ?? "Confirm tool use",
        call.name,
      );
    }
    if (gate.decision === "deny" || !allowed) {
      const result: ToolResult = {
        output: `Permission denied: ${gate.reason ?? "blocked by policy"}`,
        terminate: gate.terminate,
      };
      if (result.terminate) terminateVotes += 1;
      items.push({ call, result, isError: true });
      await emitToolEnd(options.onEvent, call, result.output, true);
      continue;
    }

    const result = await options.tools.run(call.name, call.args, {
      workspace: options.workspace,
    });
    const isError = result.output.startsWith(`Tool "${call.name}" failed:`);
    if (result.terminate) terminateVotes += 1;
    items.push({ call, result, isError });
    await emitToolEnd(options.onEvent, call, result.output, isError, result.ui);
  }

  const terminateBatch =
    items.length > 0 && terminateVotes === items.length;

  return { items, terminateBatch };
}

export function parseToolCall(call: ToolCall): ParsedToolCall {
  const id = call.id;
  const name = call.function.name;
  try {
    const args = JSON.parse(call.function.arguments || "{}") as Record<
      string,
      unknown
    >;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      return {
        id,
        name,
        args: {},
        signature: `${name}:invalid`,
        parseError: "arguments must be a JSON object",
      };
    }
    return {
      id,
      name,
      args,
      signature: `${name}:${stableStringify(args)}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id,
      name,
      args: { _raw: call.function.arguments },
      signature: `${name}:parse-error`,
      parseError: message,
    };
  }
}

export function defaultBeforeToolCall(
  workspace: string,
): (
  toolName: string,
  args: Record<string, unknown>,
) => BeforeToolCallResult {
  return (toolName, args) => {
    const perm = checkPermission({ toolName, args, workspace });
    return {
      decision: perm.decision,
      reason: perm.reason,
    };
  };
}

export function toolItemsToMessages(items: ToolBatchItem[]): ChatMessage[] {
  return items.map(({ call, result }) => ({
    role: "tool" as const,
    tool_call_id: call.id,
    content: result.output,
  }));
}

async function emitToolEnd(
  onEvent: AgentEventHandler,
  call: ParsedToolCall,
  output: string,
  isError: boolean,
  ui?: ToolResult["ui"],
): Promise<void> {
  await emitEvent(onEvent, {
    type: "tool_execution_end",
    toolCallId: call.id,
    toolName: call.name,
    output,
    isError,
    ...(ui ? { ui } : {}),
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("Agent aborted");
    err.name = "AbortError";
    throw err;
  }
}

/** Deterministic JSON for doom-loop signatures. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeys(obj[key]);
    }
    return sorted;
  }
  return value;
}
