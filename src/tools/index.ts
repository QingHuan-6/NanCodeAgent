import { askUserTool } from "./ask_user.js";
import { bashTool } from "./bash.js";
import { editFileTool } from "./edit_file.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { lspTool } from "./lsp.js";
import { readFileTool } from "./read_file.js";
import { ToolRegistry } from "./registry.js";
import { todoWriteTool } from "./todo_write.js";
import { webFetchTool, webSearchTool } from "./web.js";
import { writeFileTool } from "./write_file.js";

export type AgentToolMode = "agent" | "plan";

/** Plan mode: exploration + ask/search/lsp (no write/edit/bash). */
const PLAN_TOOLS = new Set([
  "read_file",
  "glob",
  "grep",
  "todo_write",
  "ask_user",
  "web_fetch",
  "web_search",
  "lsp",
]);

/** Full tool set. */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(bashTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(todoWriteTool);
  registry.register(askUserTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(lspTool);
  return registry;
}

export function createPlanRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(todoWriteTool);
  registry.register(askUserTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(lspTool);
  return registry;
}

export function createRegistryForMode(mode: AgentToolMode): ToolRegistry {
  return mode === "plan" ? createPlanRegistry() : createDefaultRegistry();
}

export function isPlanTool(name: string): boolean {
  return PLAN_TOOLS.has(name);
}

export { ToolRegistry } from "./registry.js";
export type {
  AskUserRequest,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types.js";
export {
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  resolveWorkspacePath,
} from "./helpers.js";
