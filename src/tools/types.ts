import type { OpenAIToolDefinition, ToolParameterSchema } from "../llm/types.js";

export interface ToolContext {
  workspace: string;
}

export interface ToolResult {
  /** Text shown back to the model as the tool message content. */
  output: string;
  /** If true, the permission layer or tool asked to stop the agent loop. */
  terminate?: boolean;
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
