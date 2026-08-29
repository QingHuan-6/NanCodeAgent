import type { ToolDefinition } from "./types.js";

/** Stub — Phase 1: read a file under the workspace. */
export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read a text file under the workspace. Args: path (relative or absolute).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to workspace or absolute" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute() {
    return { output: "[stub] read_file is not implemented yet" };
  },
};
