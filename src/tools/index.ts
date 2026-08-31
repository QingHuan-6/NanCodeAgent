/**
 * Local tools registry builders.
 */

import { isWebEnabled } from "../memory/paths.js";
import { askUserTool } from "./ask_user.js";
import { bashTool } from "./bash.js";
import { editFileTool } from "./edit_file.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { lspTool } from "./lsp.js";
import { memoryTool } from "./memory.js";
import { readFileTool } from "./read_file.js";
import { ToolRegistry } from "./registry.js";
import { skillTool } from "./skill.js";
import { skillInstallTool } from "./skill_install.js";
import { taskTool } from "./task.js";
import { todoWriteTool } from "./todo_write.js";
import { webFetchTool, webSearchTool } from "./web.js";
import { writeFileTool } from "./write_file.js";

export type AgentToolMode = "agent" | "plan";

export interface RegistryOptions {
  /** Include web_search / web_fetch (default: from settings / true). */
  web?: boolean;
  workspace?: string;
}

/** Plan mode: exploration + ask/search/lsp/skill/task(explorer)/memory (no write/edit/bash). */
const PLAN_TOOLS = new Set([
  "read_file",
  "glob",
  "grep",
  "todo_write",
  "ask_user",
  "web_fetch",
  "web_search",
  "lsp",
  "skill",
  "skill_install",
  "task",
  "memory",
]);

function resolveWeb(options?: RegistryOptions): boolean {
  if (typeof options?.web === "boolean") return options.web;
  return isWebEnabled(options?.workspace);
}

/** Full tool set. */
export function createDefaultRegistry(options?: RegistryOptions): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(bashTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(todoWriteTool);
  registry.register(askUserTool);
  if (resolveWeb(options)) {
    registry.register(webFetchTool);
    registry.register(webSearchTool);
  }
  registry.register(lspTool);
  registry.register(skillTool);
  registry.register(skillInstallTool);
  registry.register(taskTool);
  registry.register(memoryTool);
  return registry;
}

export function createPlanRegistry(options?: RegistryOptions): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(todoWriteTool);
  registry.register(askUserTool);
  if (resolveWeb(options)) {
    registry.register(webFetchTool);
    registry.register(webSearchTool);
  }
  registry.register(lspTool);
  registry.register(skillTool);
  registry.register(skillInstallTool);
  registry.register(taskTool);
  registry.register(memoryTool);
  return registry;
}

export function createRegistryForMode(
  mode: AgentToolMode,
  options?: RegistryOptions,
): ToolRegistry {
  return mode === "plan"
    ? createPlanRegistry(options)
    : createDefaultRegistry(options);
}

export function isPlanTool(name: string): boolean {
  return PLAN_TOOLS.has(name);
}

export { ToolRegistry } from "./registry.js";
export type {
  AgentHostContext,
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
