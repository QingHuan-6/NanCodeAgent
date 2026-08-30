import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogCacheDir, pullHttpCatalog } from "./catalog.js";
import { parseSkillMarkdown, skillInfoFromParsed } from "./parse.js";
import { loadSkillSources } from "./sources.js";
import type { SkillCatalogEntry, SkillInfo } from "./types.js";

const MAX_DESCRIPTION_CHARS = 500;
const MAX_WALK_UP = 12;

export interface DiscoverSkillsOptions {
  workspace: string;
  /** Include user home skill dirs (default true). */
  includeGlobal?: boolean;
  /** Include skills shipped with the nan-agent package (default true). */
  includeBundled?: boolean;
  /**
   * Include configured sources from skills.json / NAN_SKILL_SOURCES
   * (local dirs + HTTP catalog caches). Default true.
   */
  includeConfigured?: boolean;
  /** Extra roots (tests / callers). */
  extraRoots?: string[];
}

/**
 * Discover skills (OpenCode / Claude / Codex compatible roots + Nan bundled + config).
 *
 * Later roots override earlier ones on duplicate names.
 *
 * Priority (low → high):
 *   1. Package bundled-skills/
 *   2. Global home dirs
 *   3. Project walk-up (.agents / .claude / .opencode / .nan / skills)
 *   4. Configured local dirs + HTTP catalog caches (skills.json)
 */
export function discoverSkills(options: DiscoverSkillsOptions): SkillInfo[] {
  const workspace = path.resolve(options.workspace);
  const includeGlobal = options.includeGlobal !== false;
  const includeBundled = options.includeBundled !== false;
  const includeConfigured = options.includeConfigured !== false;
  const roots: string[] = [];

  if (includeBundled) {
    const bundled = resolveBundledSkillsDir();
    if (bundled) roots.push(bundled);
  }

  if (includeGlobal) {
    const home = os.homedir();
    roots.push(path.join(home, ".claude", "skills"));
    roots.push(path.join(home, ".agents", "skills"));
    roots.push(path.join(home, ".config", "opencode", "skills"));
    roots.push(path.join(home, ".nan-agent", "skills"));
  }

  roots.push(...projectSkillRoots(workspace));

  if (includeConfigured) {
    roots.push(...configuredSourceRoots(workspace));
  }

  if (options.extraRoots) {
    roots.push(...options.extraRoots);
  }

  const byName = new Map<string, SkillInfo>();
  for (const root of roots) {
    for (const skill of scanRoot(root)) {
      byName.set(skill.name, skill);
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pull HTTP catalogs from skills.json / env into the local cache.
 * Call once per session (or after skill_install) before advertising skills.
 */
export async function syncConfiguredSkillSources(
  workspace: string,
): Promise<{ ok: number; failed: string[] }> {
  const sources = loadSkillSources(workspace);
  let ok = 0;
  const failed: string[] = [];
  for (const src of sources) {
    if (src.kind !== "http") continue;
    try {
      await pullHttpCatalog(src.url);
      ok += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push(`${src.url}: ${message}`);
    }
  }
  return { ok, failed };
}

/** Absolute path to package bundled-skills/, or null. */
export function resolveBundledSkillsDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "bundled-skills"),
    path.resolve(here, "..", "bundled-skills"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // continue
    }
  }
  return null;
}

export function listModelSkills(
  options: DiscoverSkillsOptions,
): SkillCatalogEntry[] {
  return discoverSkills(options)
    .filter((s) => !s.disableModelInvocation)
    .map((s) => ({
      name: s.name,
      description: clipDesc(s.description),
      location: s.location,
    }));
}

export function findSkill(
  name: string,
  options: DiscoverSkillsOptions,
): SkillInfo | undefined {
  const key = name.trim();
  return discoverSkills(options).find((s) => s.name === key);
}

export function formatSkillsPromptSection(
  options: DiscoverSkillsOptions,
): string | null {
  const skills = listModelSkills(options);
  if (skills.length === 0) return null;

  const lines = [
    "# Available skills",
    "",
    "Specialized workflows you can load on demand with the `skill` tool.",
    "Only name and description are listed here — call `skill` with the name to load full instructions.",
    "Built-in + project/global + optional HTTP catalogs (see `.nan/skills.json` / `skill_install`).",
    "",
  ];
  for (const s of skills) {
    lines.push(`- **${s.name}**: ${s.description}`);
  }
  return lines.join("\n");
}

function configuredSourceRoots(workspace: string): string[] {
  const roots: string[] = [];
  for (const src of loadSkillSources(workspace)) {
    if (src.kind === "dir") {
      roots.push(src.path);
    } else {
      roots.push(catalogCacheDir(src.url));
    }
  }
  return roots;
}

function projectSkillRoots(workspace: string): string[] {
  const chain: string[] = [];
  let dir = path.resolve(workspace);
  for (let i = 0; i < MAX_WALK_UP; i++) {
    chain.push(dir);
    if (fs.existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const roots: string[] = [];
  for (const d of chain.reverse()) {
    roots.push(path.join(d, "skills"));
    roots.push(path.join(d, ".agents", "skills"));
    roots.push(path.join(d, ".claude", "skills"));
    roots.push(path.join(d, ".opencode", "skills"));
    roots.push(path.join(d, ".nan", "skills"));
  }
  return roots;
}

export function scanRoot(root: string): SkillInfo[] {
  const out: SkillInfo[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;

    if (ent.isDirectory()) {
      const dir = path.join(root, ent.name);
      const skillMd = path.join(dir, "SKILL.md");
      const namedMd = path.join(dir, `${ent.name}.md`);
      if (fs.existsSync(skillMd)) {
        const info = tryLoadSkillFile(skillMd, dir, ent.name);
        if (info) out.push(info);
      } else if (fs.existsSync(namedMd)) {
        const info = tryLoadSkillFile(namedMd, dir, ent.name);
        if (info) out.push(info);
      }
      continue;
    }

    if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
      const base = ent.name.replace(/\.md$/i, "");
      if (base.toLowerCase() === "skill") continue;
      const filePath = path.join(root, ent.name);
      const info = tryLoadSkillFile(filePath, root, base);
      if (info) out.push(info);
    }
  }
  return out;
}

function tryLoadSkillFile(
  location: string,
  directory: string,
  fallbackName?: string,
): SkillInfo | null {
  try {
    if (!fs.existsSync(location) || !fs.statSync(location).isFile()) {
      return null;
    }
    const raw = fs.readFileSync(location, "utf8");
    const parsed = parseSkillMarkdown(raw);
    return skillInfoFromParsed(location, directory, parsed, fallbackName);
  } catch {
    return null;
  }
}

function clipDesc(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_DESCRIPTION_CHARS) return oneLine;
  return `${oneLine.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`;
}
