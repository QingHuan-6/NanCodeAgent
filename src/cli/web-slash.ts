/**
 * /web on|off|toggle [user|project] — enable or disable web_search / web_fetch.
 */

import {
  envWebOverride,
  isWebEnabled,
  projectSettingsPath,
  setWebEnabled,
  toggleWebEnabled,
  userSettingsPath,
  type MemorySettingsScope,
} from "../memory/paths.js";

export type WebSlashAction =
  | { kind: "status" }
  | { kind: "on" | "off" | "toggle"; scope: MemorySettingsScope }
  | { kind: "error"; message: string };

export function parseWebSlashArg(arg: string): WebSlashAction {
  const parts = arg.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { kind: "status" };

  const cmd = parts[0]!;
  const scopeRaw = parts[1];
  const scope: MemorySettingsScope =
    scopeRaw === "project" || scopeRaw === "proj" || scopeRaw === "p"
      ? "project"
      : "user";

  if (cmd === "on" || cmd === "enable" || cmd === "1") {
    return { kind: "on", scope };
  }
  if (cmd === "off" || cmd === "disable" || cmd === "0") {
    return { kind: "off", scope };
  }
  if (cmd === "toggle" || cmd === "t") {
    return { kind: "toggle", scope };
  }
  if (cmd === "status" || cmd === "s") {
    return { kind: "status" };
  }
  return {
    kind: "error",
    message:
      "Usage: /web | /web on|off|toggle [user|project]\n  Controls web_search / web_fetch. Env NAN_WEB overrides when set.",
  };
}

export function applyWebSlash(
  workspace: string,
  action: WebSlashAction,
): string {
  if (action.kind === "error") return action.message;
  if (action.kind === "status") {
    const on = isWebEnabled(workspace);
    const env = envWebOverride();
    const source =
      env !== null
        ? `env NAN_WEB=${process.env.NAN_WEB}`
        : `settings (user ${userSettingsPath()} · project ${projectSettingsPath(workspace)})`;
    return `Web tools: ${on ? "ON" : "OFF"} (${source})`;
  }

  if (envWebOverride() !== null) {
    return `Cannot change: NAN_WEB=${process.env.NAN_WEB} overrides UI (unset it to use /web on|off).`;
  }

  const enabled =
    action.kind === "toggle"
      ? toggleWebEnabled(action.scope, workspace).enabled
      : setWebEnabled(action.kind === "on", action.scope, workspace).enabled;

  const where =
    action.scope === "project"
      ? projectSettingsPath(workspace)
      : userSettingsPath();
  return `Web tools ${enabled ? "ON" : "OFF"} → ${where}`;
}
