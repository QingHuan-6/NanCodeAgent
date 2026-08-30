import {
  getSubagentDepth,
  runSubagent,
  type SubagentType,
} from "../agent/subagent.js";
import { parseForkTurns } from "../agent/fork-context.js";
import { truncateOutput } from "./helpers.js";
import type { ToolDefinition } from "./types.js";

const TYPES = new Set<SubagentType>(["explorer", "worker"]);

/**
 * Delegate work to an in-process subagent (OpenCode `task` + Codex fork context).
 */
export const taskTool: ToolDefinition = {
  name: "task",
  description: [
    "Delegate a subtask to a subagent with its own session.",
    "By default forks parent conversation history (Codex-style) so the child reuses prior reads/context — more token-efficient than a blank slate.",
    "Set fork_turns=none for a clean specialist spawn; fork_turns=N keeps only the last N user turns.",
    "subagent_type=explorer: read-only investigation (read/glob/grep/web/lsp/skill/ask).",
    "subagent_type=worker: can edit files and run bash (still cannot nest another task).",
    "Pass task_id from a previous task_result to continue the same child session (fork ignored on resume).",
    "Prefer one clear goal per task. Summaries come back as the tool result.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Short 3–8 word label for the UI / logs",
      },
      prompt: {
        type: "string",
        description: "Full instructions for the subagent (active task boundary)",
      },
      subagent_type: {
        type: "string",
        description: "explorer | worker",
      },
      task_id: {
        type: "string",
        description: "Optional prior child session id to resume",
      },
      fork_turns: {
        type: "string",
        description:
          'Parent history to copy: "all" (default), "none", or integer string for last N user turns',
      },
      max_turns: {
        type: "number",
        description: "Optional turn cap for the child (default explorer 12 / worker 20)",
      },
    },
    required: ["description", "prompt", "subagent_type"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const description =
      typeof args.description === "string" ? args.description.trim() : "";
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    const rawType =
      typeof args.subagent_type === "string"
        ? args.subagent_type.trim().toLowerCase()
        : "";
    if (!description) throw new Error("description is required");
    if (!prompt) throw new Error("prompt is required");
    if (!TYPES.has(rawType as SubagentType)) {
      throw new Error('subagent_type must be "explorer" or "worker"');
    }
    const subagentType = rawType as SubagentType;
    const taskId =
      typeof args.task_id === "string" && args.task_id.trim()
        ? args.task_id.trim()
        : undefined;
    const maxTurns =
      typeof args.max_turns === "number" && Number.isFinite(args.max_turns)
        ? Math.max(1, Math.min(40, Math.floor(args.max_turns)))
        : undefined;
    const forkTurns = parseForkTurns(
      args.fork_turns !== undefined ? args.fork_turns : args.forkTurns,
    );

    if (!ctx.agent) {
      throw new Error(
        "task is unavailable: agent host not wired (internal error)",
      );
    }

    if (ctx.agent.mode === "plan" && subagentType === "worker") {
      throw new Error(
        'Plan mode only allows subagent_type="explorer". Switch to /agent for worker tasks.',
      );
    }

    const maxDepth =
      ctx.agent.maxSubagentDepth ??
      (Number(process.env.NAN_SUBAGENT_DEPTH) || 1);
    const depth = getSubagentDepth();
    const parentMessages = ctx.agent.getParentMessages?.() ?? [];

    const result = await runSubagent({
      prompt,
      description,
      subagentType,
      taskId,
      forkTurns,
      parentMessages,
      workspace: ctx.workspace,
      llm: ctx.agent.llm,
      askPermission: ctx.agent.askPermission,
      askUser: ctx.askUser ?? ctx.agent.askUser,
      signal: ctx.agent.signal,
      transformContext: ctx.agent.transformContext,
      onEvent: ctx.agent.onEvent,
      maxTurns,
      depth,
      maxDepth,
    });

    const lines = [
      `<task_result>`,
      `task_id: ${result.taskId}`,
      `subagent_type: ${result.subagentType}`,
      `description: ${result.description}`,
      `forked_messages: ${result.forkedMessages}`,
      `stop_reason: ${result.stopReason}`,
      `turns: ${result.turns}`,
      result.toolNames.length
        ? `tools_used: ${result.toolNames.join(", ")}`
        : "tools_used: (none)",
      "",
      result.finalText,
      `</task_result>`,
      "",
      "To continue this subagent later, call task again with the same task_id and subagent_type.",
    ];

    return { output: truncateOutput(lines.join("\n"), 48_000) };
  },
};
