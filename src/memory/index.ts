/**
 * Instruction + auto-memory loaders for the system prompt.
 */

import fs from "node:fs";
import path from "node:path";
import {
  envAutoMemoryOverride,
  globalAgentsPath,
  isAutoMemoryEnabled,
  memoryIndexPath,
  projectMemoryDir,
  projectSettingsPath,
  setAutoMemoryEnabled,
  toggleAutoMemoryEnabled,
  userSettingsPath,
  type MemorySettingsScope,
} from "./paths.js";

const MAX_GLOBAL_AGENTS_CHARS = 4_000;
const MAX_MEMORY_INDEX_CHARS = 12_000;
const MAX_MEMORY_INDEX_LINES = 200;
const MAX_PROGRESS_CHARS = 3_000;

export function loadGlobalAgentsMarkdown(): string | null {
  const file = globalAgentsPath();
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    const text = truncateChars(fs.readFileSync(file, "utf8"), MAX_GLOBAL_AGENTS_CHARS);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/**
 * Load MEMORY.md head for session start (Claude-style budget).
 */
export function loadMemoryIndexForPrompt(workspace: string): string | null {
  if (!isAutoMemoryEnabled(workspace)) return null;
  const file = memoryIndexPath(workspace);
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    const raw = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    const clippedLines = lines.slice(0, MAX_MEMORY_INDEX_LINES).join("\n");
    const text = truncateChars(clippedLines, MAX_MEMORY_INDEX_CHARS).trim();
    if (!text) return null;
    const truncated =
      lines.length > MAX_MEMORY_INDEX_LINES || raw.length > MAX_MEMORY_INDEX_CHARS;
    const note = truncated
      ? "\n\n(Index truncated for prompt budget. Use the memory tool to read topic files.)"
      : "";
    return `${text}${note}`;
  } catch {
    return null;
  }
}

/** Optional long-running handoff file in the workspace. */
export function loadProgressMarkdown(workspace: string): string | null {
  const candidates = [
    path.join(workspace, ".nan", "PROGRESS.md"),
    path.join(workspace, "PROGRESS.md"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const text = truncateChars(fs.readFileSync(file, "utf8"), MAX_PROGRESS_CHARS);
      if (!text.trim()) continue;
      const label = path.relative(workspace, file).replace(/\\/g, "/");
      return `## ${label}\n\n${text.trim()}`;
    } catch {
      // try next
    }
  }
  return null;
}

export function formatMemoryPromptSection(workspace: string): string | null {
  if (!isAutoMemoryEnabled(workspace)) return null;
  const index = loadMemoryIndexForPrompt(workspace);
  const dir = projectMemoryDir(workspace);
  const lines = [
    "# Auto memory",
    "",
    `Durable notes for this workspace live under \`${dir}\` (not in git).`,
    "Use the `memory` tool to list / read / write / append `.md` files. Keep MEMORY.md as a short index; put details in topic files.",
    "Record reusable build commands, debugging fixes, architecture decisions, and user preferences — not secrets or one-off chatter.",
  ];
  if (index) {
    lines.push("", "## MEMORY.md (index)", "", index);
  } else {
    lines.push(
      "",
      "No MEMORY.md yet. When you learn something durable, create one with memory(operation=write, path=MEMORY.md, …).",
    );
  }
  return lines.join("\n");
}

export function formatGlobalAgentsSection(): string | null {
  const body = loadGlobalAgentsMarkdown();
  if (!body) return null;
  return `# User instructions\n\nFrom \`~/.nan-agent/AGENTS.md\`:\n\n${body}`;
}

export type MemorySlashAction =
  | { kind: "status" }
  | { kind: "set"; enabled: boolean; scope: MemorySettingsScope }
  | { kind: "toggle"; scope: MemorySettingsScope };

export function parseMemorySlashArg(arg: string): MemorySlashAction | { kind: "error"; message: string } {
  const parts = arg.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { kind: "status" };

  const cmd = parts[0]!;
  const scopeRaw = parts[1];
  const scope: MemorySettingsScope =
    scopeRaw === "project" || scopeRaw === "proj" ? "project" : "user";

  if (cmd === "status" || cmd === "show" || cmd === "paths") {
    return { kind: "status" };
  }
  if (cmd === "on" || cmd === "enable" || cmd === "true" || cmd === "1") {
    return { kind: "set", enabled: true, scope };
  }
  if (cmd === "off" || cmd === "disable" || cmd === "false" || cmd === "0") {
    return { kind: "set", enabled: false, scope };
  }
  if (cmd === "toggle" || cmd === "t") {
    return { kind: "toggle", scope };
  }
  return {
    kind: "error",
    message:
      "Usage: /memory | /memory on|off|toggle [user|project]\n  user = ~/.nan-agent/settings.json (default)\n  project = .nan/settings.json",
  };
}

/** Apply /memory on|off|toggle; returns user-facing text. */
export function applyMemorySlash(
  workspace: string,
  action: MemorySlashAction,
): string {
  if (action.kind === "status") {
    return memoryStatusText(workspace);
  }

  const env = envAutoMemoryOverride();
  if (env !== null) {
    return [
      memoryStatusText(workspace),
      "",
      `Cannot change settings: NAN_AUTO_MEMORY=${process.env.NAN_AUTO_MEMORY} overrides UI (unset it to use /memory on|off).`,
    ].join("\n");
  }

  const result =
    action.kind === "toggle"
      ? toggleAutoMemoryEnabled(action.scope, workspace)
      : setAutoMemoryEnabled(action.enabled, action.scope, workspace);

  return [
    `Auto memory → ${result.enabled ? "ON" : "OFF"} (${action.scope})`,
    `Saved: ${result.file}`,
    "",
    memoryStatusText(workspace),
    "",
    "System prompt refreshed for the next turn.",
  ].join("\n");
}

/** Claude-like /memory panel: status + controls. */
export function memoryStatusText(workspace: string): string {
  const enabled = isAutoMemoryEnabled(workspace);
  const agents = globalAgentsPath();
  const dir = projectMemoryDir(workspace);
  const index = memoryIndexPath(workspace);
  const agentsExists = fs.existsSync(agents);
  const indexExists = fs.existsSync(index);

  return [
    "── Memory ──",
    `Auto memory: ${enabled ? "ON" : "OFF"}  (${describeEnableSource(workspace)})`,
    "",
    "Controls (Claude-style):",
    "  /memory on | off | toggle          user settings",
    "  /memory on project | off project   this repo (.nan/settings.json)",
    "",
    `user_agents: ${agents}${agentsExists ? "" : " (missing — create to set global prefs)"}`,
    `memory_dir:  ${dir}`,
    `MEMORY.md:   ${index}${indexExists ? "" : " (missing)"}`,
    `user_settings:    ${userSettingsPath()}`,
    `project_settings: ${projectSettingsPath(workspace)}`,
    "",
    "Team rules → project AGENTS.md / CLAUDE.md (git).",
    "Personal notes → memory tool → MEMORY.md + topics (local).",
    "Long tasks → .nan/PROGRESS.md or PROGRESS.md.",
  ].join("\n");
}

function describeEnableSource(workspace: string): string {
  const env = envAutoMemoryOverride();
  if (env !== null) {
    return `env NAN_AUTO_MEMORY=${process.env.NAN_AUTO_MEMORY}`;
  }
  try {
    const projFile = projectSettingsPath(workspace);
    if (fs.existsSync(projFile)) {
      const j = JSON.parse(fs.readFileSync(projFile, "utf8")) as {
        autoMemoryEnabled?: boolean;
      };
      if (typeof j.autoMemoryEnabled === "boolean") {
        return "project .nan/settings.json";
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const userFile = userSettingsPath();
    if (fs.existsSync(userFile)) {
      const j = JSON.parse(fs.readFileSync(userFile, "utf8")) as {
        autoMemoryEnabled?: boolean;
      };
      if (typeof j.autoMemoryEnabled === "boolean") {
        return "user ~/.nan-agent/settings.json";
      }
    }
  } catch {
    /* ignore */
  }
  return "default (on)";
}

function truncateChars(text: string, max: number): string {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 20))}\n…[truncated]`;
}

export {
  globalAgentsPath,
  isAutoMemoryEnabled,
  isWebEnabled,
  memoryIndexPath,
  projectMemoryDir,
  resolveMemoryFile,
  ensureMemoryDir,
  workspaceMemoryId,
  setAutoMemoryEnabled,
  setWebEnabled,
  toggleAutoMemoryEnabled,
  toggleWebEnabled,
  envAutoMemoryOverride,
  envWebOverride,
  userSettingsPath,
  projectSettingsPath,
} from "./paths.js";
export type { MemorySettingsScope, NanSettings } from "./paths.js";
