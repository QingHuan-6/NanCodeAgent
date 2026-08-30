/**
 * In-process sub-agent runner (OpenCode task + Codex/DSH fork-style context).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { AskUserRequest } from "../tools/types.js";
import {
  createSubagentRegistry,
  type SubagentType,
} from "../tools/subagent-registry.js";
import type { ChatMessage } from "../llm/types.js";
import { Session } from "../session/session.js";
import type { AgentEvent, AgentEventHandler } from "./events.js";
import {
  forkParentMessages,
  type ForkTurns,
} from "./fork-context.js";
import { runAgentLoop } from "./loop.js";
import { buildSystemPrompt } from "./prompt.js";
import type { AgentLoopOptions, LlmChatPort } from "./types.js";

export type { SubagentType };
export type { ForkTurns };

export interface SubagentRunRequest {
  prompt: string;
  description: string;
  subagentType: SubagentType;
  /** Resume a previous child session id. */
  taskId?: string;
  /**
   * How much parent history to copy into a new child (ignored on resume).
   * Default `"all"` (Codex-style fork). Use `"none"` for a clean specialist spawn.
   */
  forkTurns?: ForkTurns;
  /** Parent session messages at spawn time (for fork). */
  parentMessages?: ChatMessage[];
  workspace: string;
  llm: LlmChatPort;
  askPermission?: (reason: string, toolName: string) => Promise<boolean>;
  askUser?: (req: AskUserRequest) => Promise<string>;
  signal?: AbortSignal;
  transformContext?: AgentLoopOptions["transformContext"];
  onEvent?: AgentEventHandler;
  maxTurns?: number;
  /** Current nesting depth of the caller (0 = top-level agent). */
  depth: number;
  maxDepth: number;
}

export interface SubagentRunResult {
  taskId: string;
  subagentType: SubagentType;
  description: string;
  finalText: string;
  turns: number;
  stopReason: string;
  toolNames: string[];
  forkedMessages: number;
}

interface ChildRecord {
  session: Session;
  subagentType: SubagentType;
  description: string;
}

interface DepthStore {
  depth: number;
}

const depthAls = new AsyncLocalStorage<DepthStore>();
const children = new Map<string, ChildRecord>();

export function getSubagentDepth(): number {
  return depthAls.getStore()?.depth ?? 0;
}

export async function runSubagent(
  req: SubagentRunRequest,
): Promise<SubagentRunResult> {
  if (req.depth >= req.maxDepth) {
    throw new Error(
      `Subagent depth limit reached (${req.maxDepth}). Increase NAN_SUBAGENT_DEPTH to allow nesting.`,
    );
  }

  const childDepth = req.depth + 1;
  const tools = createSubagentRegistry(req.subagentType);
  const maxTurns = req.maxTurns ?? (req.subagentType === "explorer" ? 12 : 20);
  const forkTurns: ForkTurns = req.forkTurns ?? "all";

  let record: ChildRecord;
  let forkedMessages = 0;
  let isResume = false;

  if (req.taskId) {
    const existing = children.get(req.taskId);
    if (!existing) {
      throw new Error(`Unknown task_id: ${req.taskId}`);
    }
    if (existing.subagentType !== req.subagentType) {
      throw new Error(
        `task_id ${req.taskId} is a ${existing.subagentType} agent, not ${req.subagentType}`,
      );
    }
    record = existing;
    record.description = req.description;
    isResume = true;
  } else {
    const session = new Session({
      id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const prefix = forkParentMessages(req.parentMessages ?? [], forkTurns);
    forkedMessages = prefix.length;
    session.replaceMessages(prefix);
    record = {
      session,
      subagentType: req.subagentType,
      description: req.description,
    };
    children.set(session.id, record);
  }

  const toolNames: string[] = [];
  const onEvent = wrapChildEvents(req.onEvent, req.subagentType, toolNames);

  const mode = req.subagentType === "explorer" ? "plan" : "agent";
  const roleLines =
    req.subagentType === "explorer"
      ? [
          "You are a read-only explorer subagent.",
          "Investigate and report findings. Do not claim you modified files.",
          "End with a concise summary the parent agent can use.",
        ]
      : [
          "You are a worker subagent.",
          "Complete the assigned task in the workspace, then summarize what you changed.",
          "Do not spawn further subagents (task tool unavailable).",
        ];

  if (!isResume && forkedMessages > 0) {
    roleLines.push(
      "Earlier messages are forked parent context for reference only.",
      "Your active assignment is the latest user message in this session.",
      "Do not continue the parent's orchestration or re-delegate; do the delegated work yourself.",
    );
  }

  const systemContent = buildSystemPrompt({
    workspace: req.workspace,
    mode,
    extraInstructions: roleLines.join(" "),
  });
  const msgs = record.session.getMessages().filter((m) => m.role !== "system");
  record.session.replaceMessages([
    { role: "system", content: systemContent },
    ...msgs,
  ]);

  const loopOptions: AgentLoopOptions = {
    llm: req.llm,
    tools,
    session: record.session,
    workspace: req.workspace,
    maxTurns,
    stream: true,
    toolExecution: "parallel",
    mode,
    onEvent,
    signal: req.signal,
    askPermission: req.askPermission,
    askUser: req.askUser,
    transformContext: req.transformContext,
  };

  const result = await depthAls.run({ depth: childDepth }, () =>
    runAgentLoop(req.prompt, loopOptions),
  );

  const finalText =
    result.finalText?.trim() ||
    lastAssistantText(record.session) ||
    "(subagent produced no text)";

  return {
    taskId: record.session.id,
    subagentType: req.subagentType,
    description: req.description,
    finalText,
    turns: result.turns,
    stopReason: result.stopReason,
    toolNames: [...new Set(toolNames)],
    forkedMessages,
  };
}

/** Test helper. */
export function clearSubagentChildren(): void {
  children.clear();
}

function lastAssistantText(session: Session): string {
  const messages = session.getMessages();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (
      m.role === "assistant" &&
      typeof m.content === "string" &&
      m.content.trim()
    ) {
      return m.content.trim();
    }
  }
  return "";
}

function wrapChildEvents(
  parent: AgentEventHandler | undefined,
  subagentType: SubagentType,
  toolNames: string[],
): AgentEventHandler {
  return async (event: AgentEvent) => {
    if (!parent) return;
    switch (event.type) {
      case "tool_execution_start":
        toolNames.push(event.toolName);
        await parent({
          ...event,
          toolName: `${subagentType}.${event.toolName}`,
          args: { ...event.args, _subagent: subagentType },
        });
        return;
      case "tool_execution_end":
        await parent({
          ...event,
          toolName: `${subagentType}.${event.toolName}`,
        });
        return;
      case "permission":
      case "error":
        await parent(event);
        return;
      default:
        return;
    }
  };
}
