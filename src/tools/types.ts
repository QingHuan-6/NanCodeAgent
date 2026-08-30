import type { ToolUiMeta } from "../agent/events.js";
import type { AgentEventHandler } from "../agent/events.js";
import type { AgentLoopOptions, LlmChatPort } from "../agent/types.js";
import type { ChatMessage, OpenAIToolDefinition, ToolParameterSchema } from "../llm/types.js";

export interface AskUserRequest {
  question: string;
  options?: string[];
}

/** Host capabilities so tools like `task` can spawn nested agent loops. */
export interface AgentHostContext {
  llm: LlmChatPort;
  onEvent?: AgentEventHandler;
  askPermission?: (reason: string, toolName: string) => Promise<boolean>;
  askUser?: (req: AskUserRequest) => Promise<string>;
  signal?: AbortSignal;
  transformContext?: AgentLoopOptions["transformContext"];
  maxSubagentDepth?: number;
  /** Parent agent mode — plan forbids worker subagents. */
  mode?: "agent" | "plan";
  /** Snapshot parent history for Codex-style fork (exclude live share). */
  getParentMessages?: () => ChatMessage[];
}

export interface ToolContext {
  workspace: string;
  /** Session id for todo_write and other session-scoped tools. */
  sessionId?: string;
  /** Interactive Q&A (ask_user tool). */
  askUser?: (req: AskUserRequest) => Promise<string>;
  /** Parent agent host (required for task / subagents). */
  agent?: AgentHostContext;
}

export interface ToolResult {
  /** Text shown back to the model as the tool message content. */
  output: string;
  /** If true, the permission layer or tool asked to stop the agent loop. */
  terminate?: boolean;
  /** Optional UI metadata (diffs, etc.) — not sent to the model. */
  ui?: ToolUiMeta;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export function toOpenAITool(tool: ToolDefinition): OpenAIToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
