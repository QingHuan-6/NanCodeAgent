import { bashTool } from "./bash.js";
import { editFileTool } from "./edit_file.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readFileTool } from "./read_file.js";
import { ToolRegistry } from "./registry.js";
import { todoWriteTool } from "./todo_write.js";
import { writeFileTool } from "./write_file.js";

export type AgentToolMode = "agent" | "plan";

const PLAN_TOOLS = new Set(["read_file", "glob", "grep", "todo_write"]);

/** Full tool set: read / write / edit / bash / glob / grep / todo_write. */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(bashTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(todoWriteTool);
  return registry;
}

/** Plan mode: read-only exploration + todo checklist (no write/edit/bash). */
export function createPlanRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(todoWriteTool);
  return registry;
}

export function createRegistryForMode(mode: AgentToolMode): ToolRegistry {
  return mode === "plan" ? createPlanRegistry() : createDefaultRegistry();
}

export function isPlanTool(name: string): boolean {
  return PLAN_TOOLS.has(name);
}

export { ToolRegistry } from "./registry.js";
export type { ToolContext, ToolDefinition, ToolResult } from "./types.js";
export {
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  resolveWorkspacePath,
} from "./helpers.js";
