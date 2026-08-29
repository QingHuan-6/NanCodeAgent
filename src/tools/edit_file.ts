import type { ToolDefinition } from "./types.js";

/** Stub — Phase 1: exact string replace in a file. */
export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description:
    "Replace an exact string in a file. Args: path, old_string, new_string. old_string must match uniquely.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to workspace or absolute" },
      old_string: { type: "string", description: "Exact text to find" },
      new_string: { type: "string", description: "Replacement text" },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async execute() {
    return { output: "[stub] edit_file is not implemented yet" };
  },
};
