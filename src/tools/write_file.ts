import type { ToolDefinition } from "./types.js";

/** Stub — Phase 1: write/overwrite a file under the workspace. */
export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write contents to a file under the workspace (creates parent dirs). Args: path, content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to workspace or absolute" },
      content: { type: "string", description: "Full file contents to write" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute() {
    return { output: "[stub] write_file is not implemented yet" };
  },
};
