import type { ToolDefinition } from "./types.js";

/** Stub — Phase 1: run a shell command inside the workspace. */
export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Run a shell command in the workspace directory. Args: command.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute() {
    return { output: "[stub] bash is not implemented yet" };
  },
};
