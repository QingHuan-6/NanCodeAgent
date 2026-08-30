/**
 * Tool registries for child agents (no task / todo_write — avoids recursion & todo fights).
 */

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
import { webFetchTool, webSearchTool } from "./web.js";
import { writeFileTool } from "./write_file.js";

export type SubagentType = "explorer" | "worker";

export function createSubagentRegistry(type: SubagentType): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(askUserTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(lspTool);
  registry.register(skillTool);
  registry.register(skillInstallTool);
  registry.register(memoryTool);

  if (type === "worker") {
    registry.register(writeFileTool);
    registry.register(editFileTool);
    registry.register(bashTool);
  }
  return registry;
}
