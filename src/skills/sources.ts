import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { userConfigDir } from "../config/env.js";

/**
 * OpenCode-style skill sources: local dirs and HTTP catalog base URLs.
 * Loaded from (later entries append; duplicates by URL/path kept once):
 *   1. ~/.nan-agent/skills.json
 *   2. {workspace}/.nan/skills.json
 *   3. NAN_SKILL_SOURCES env (comma-separated)
 */

export type SkillSource =
  | { kind: "dir"; path: string }
  | { kind: "http"; url: string };

export interface SkillsJson {
  /** Local dirs and/or https catalog base URLs (OpenCode `skills` array). */
  skills?: string[];
}

export function skillsConfigPath(scope: "user" | "project", workspace?: string): string {
  if (scope === "user") {
    return path.join(userConfigDir(), "skills.json");
  }
  return path.join(path.resolve(workspace ?? process.cwd()), ".nan", "skills.json");
}

export function loadSkillSources(workspace: string): SkillSource[] {
  const seen = new Set<string>();
  const out: SkillSource[] = [];

  const add = (raw: string) => {
    const parsed = parseSourceEntry(raw, workspace);
    if (!parsed) return;
    const key =
      parsed.kind === "http"
        ? `http:${parsed.url}`
        : `dir:${path.resolve(parsed.path)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(parsed);
  };

  for (const file of [
    skillsConfigPath("user"),
    skillsConfigPath("project", workspace),
  ]) {
    for (const entry of readSkillsJson(file)) add(entry);
  }

  const env = process.env.NAN_SKILL_SOURCES?.trim();
  if (env) {
    if (env.startsWith("[")) {
      try {
        const arr = JSON.parse(env) as unknown;
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (typeof item === "string") add(item);
          }
        }
      } catch {
        // fall through to comma split
      }
    } else {
      for (const part of env.split(",")) add(part.trim());
    }
  }

  return out;
}

/** Append a source to user or project skills.json (deduped). */
export function appendSkillSource(
  entry: string,
  options: { workspace: string; global?: boolean },
): { path: string; added: boolean } {
  const file = options.global
    ? skillsConfigPath("user")
    : skillsConfigPath("project", options.workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data: SkillsJson = {};
  try {
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, "utf8")) as SkillsJson;
    }
  } catch {
    data = {};
  }
  const list = Array.isArray(data.skills) ? [...data.skills] : [];
  const normalized = entry.trim();
  if (list.includes(normalized)) {
    return { path: file, added: false };
  }
  list.push(normalized);
  data.skills = list;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return { path: file, added: true };
}

function readSkillsJson(file: string): string[] {
  try {
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as SkillsJson;
    if (!Array.isArray(data.skills)) return [];
    return data.skills.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

function parseSourceEntry(raw: string, workspace: string): SkillSource | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    const url = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    return { kind: "http", url };
  }
  let p = trimmed;
  if (p.startsWith("~/") || p === "~") {
    p = path.join(os.homedir(), p.slice(2));
  } else if (!path.isAbsolute(p)) {
    p = path.resolve(workspace, p);
  }
  return { kind: "dir", path: p };
}
