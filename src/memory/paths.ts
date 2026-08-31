/**
 * File-based memory paths + enable flag (Claude-style settings + env override).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { userConfigDir } from "../config/env.js";

export type MemorySettingsScope = "user" | "project";

export interface NanSettings {
  autoMemoryEnabled?: boolean;
  /** When false, web_search / web_fetch are removed from the tool registry. */
  webEnabled?: boolean;
}

/** Stable id for a workspace root (path hash). */
export function workspaceMemoryId(workspace: string): string {
  const resolved = path.resolve(workspace);
  return createHash("sha256").update(resolved).digest("hex").slice(0, 16);
}

export function projectMemoryDir(workspace: string): string {
  return path.join(
    userConfigDir(),
    "projects",
    workspaceMemoryId(workspace),
    "memory",
  );
}

export function memoryIndexPath(workspace: string): string {
  return path.join(projectMemoryDir(workspace), "MEMORY.md");
}

export function globalAgentsPath(): string {
  return path.join(userConfigDir(), "AGENTS.md");
}

export function userSettingsPath(): string {
  return path.join(userConfigDir(), "settings.json");
}

export function projectSettingsPath(workspace: string): string {
  return path.join(path.resolve(workspace), ".nan", "settings.json");
}

function readSettingsFile(file: string): NanSettings {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return {};
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    const out: NanSettings = {};
    if (typeof obj.autoMemoryEnabled === "boolean") {
      out.autoMemoryEnabled = obj.autoMemoryEnabled;
    }
    if (typeof obj.webEnabled === "boolean") {
      out.webEnabled = obj.webEnabled;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSettingsFile(file: string, patch: NanSettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = readSettingsFile(file);
  const next = { ...current, ...patch };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

/** Env override when NAN_AUTO_MEMORY is set (CI / hard pin). */
export function envAutoMemoryOverride(): boolean | null {
  const raw = process.env.NAN_AUTO_MEMORY?.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") {
    return true;
  }
  return null;
}

/**
 * Effective auto-memory flag.
 * Precedence: NAN_AUTO_MEMORY env → project .nan/settings.json → ~/.nan-agent/settings.json → true.
 */
export function isAutoMemoryEnabled(workspace?: string): boolean {
  const env = envAutoMemoryOverride();
  if (env !== null) return env;
  if (workspace) {
    const project = readSettingsFile(projectSettingsPath(workspace));
    if (typeof project.autoMemoryEnabled === "boolean") {
      return project.autoMemoryEnabled;
    }
  }
  const user = readSettingsFile(userSettingsPath());
  if (typeof user.autoMemoryEnabled === "boolean") {
    return user.autoMemoryEnabled;
  }
  return true;
}

export function setAutoMemoryEnabled(
  enabled: boolean,
  scope: MemorySettingsScope,
  workspace?: string,
): { file: string; enabled: boolean } {
  if (scope === "project") {
    if (!workspace) {
      throw new Error("project scope requires a workspace path");
    }
    const file = projectSettingsPath(workspace);
    writeSettingsFile(file, { autoMemoryEnabled: enabled });
    return { file, enabled };
  }
  const file = userSettingsPath();
  writeSettingsFile(file, { autoMemoryEnabled: enabled });
  return { file, enabled };
}

export function toggleAutoMemoryEnabled(
  scope: MemorySettingsScope,
  workspace?: string,
): { file: string; enabled: boolean } {
  const next = !isAutoMemoryEnabled(workspace);
  return setAutoMemoryEnabled(next, scope, workspace);
}

/** Env override when NAN_WEB is set. */
export function envWebOverride(): boolean | null {
  const raw = process.env.NAN_WEB?.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") {
    return true;
  }
  return null;
}

/**
 * Effective web tools flag.
 * Precedence: NAN_WEB env → project .nan/settings.json → ~/.nan-agent/settings.json → true.
 */
export function isWebEnabled(workspace?: string): boolean {
  const env = envWebOverride();
  if (env !== null) return env;
  if (workspace) {
    const project = readSettingsFile(projectSettingsPath(workspace));
    if (typeof project.webEnabled === "boolean") {
      return project.webEnabled;
    }
  }
  const user = readSettingsFile(userSettingsPath());
  if (typeof user.webEnabled === "boolean") {
    return user.webEnabled;
  }
  return true;
}

export function setWebEnabled(
  enabled: boolean,
  scope: MemorySettingsScope,
  workspace?: string,
): { file: string; enabled: boolean } {
  if (scope === "project") {
    if (!workspace) {
      throw new Error("project scope requires a workspace path");
    }
    const file = projectSettingsPath(workspace);
    writeSettingsFile(file, { webEnabled: enabled });
    return { file, enabled };
  }
  const file = userSettingsPath();
  writeSettingsFile(file, { webEnabled: enabled });
  return { file, enabled };
}

export function toggleWebEnabled(
  scope: MemorySettingsScope,
  workspace?: string,
): { file: string; enabled: boolean } {
  const next = !isWebEnabled(workspace);
  return setWebEnabled(next, scope, workspace);
}

/** Resolve a relative memory file under the project memory dir (no escape). */
export function resolveMemoryFile(
  workspace: string,
  relative: string,
): { ok: true; absolute: string; relative: string } | { ok: false; reason: string } {
  const root = path.resolve(projectMemoryDir(workspace));
  const rel = (relative || "MEMORY.md").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "path must be a relative file under the memory directory" };
  }
  if (!rel.toLowerCase().endsWith(".md")) {
    return { ok: false, reason: "memory files must be .md" };
  }
  const absolute = path.resolve(root, rel);
  const fromRoot = path.relative(root, absolute);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    return { ok: false, reason: "path escapes memory directory" };
  }
  return { ok: true, absolute, relative: fromRoot.replace(/\\/g, "/") };
}

export function ensureMemoryDir(workspace: string): string {
  const dir = projectMemoryDir(workspace);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
