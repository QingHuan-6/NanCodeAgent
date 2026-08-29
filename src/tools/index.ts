import { bashTool } from "./bash.js";
import { editFileTool } from "./edit_file.js";
import { readFileTool } from "./read_file.js";
import { ToolRegistry } from "./registry.js";
import { writeFileTool } from "./write_file.js";

/** Build the default MVP tool set (stubs until Phase 1 implements them). */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(bashTool);
  return registry;
}

export { ToolRegistry } from "./registry.js";
export type { ToolContext, ToolDefinition, ToolResult } from "./types.js";
