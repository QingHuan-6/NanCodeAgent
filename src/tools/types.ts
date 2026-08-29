import type { ToolUiMeta } from "../agent/events.js";
import type { OpenAIToolDefinition, ToolParameterSchema } from "../llm/types.js";

export interface ToolContext {
  workspace: string;
  /** Session id for todo_write and other session-scoped tools. */
  sessionId?: string;
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
