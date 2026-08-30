import fs from "node:fs";
import path from "node:path";
import {
  findSkill,
  listModelSkills,
  parseSkillMarkdown,
} from "../skills/index.js";
import { truncateOutput } from "./helpers.js";
import type { ToolDefinition } from "./types.js";

const MAX_SKILL_CHARS = 40_000;
const MAX_LISTED_FILES = 10;

/**
 * Load a skill's full instructions (OpenCode / DeepSeek `skill` tool).
 * Re-reads SKILL.md from disk so edits apply without restart.
 */
export const skillTool: ToolDefinition = {
  name: "skill",
  description: [
    "Load a specialized skill's full instructions into the conversation.",
    "Use when the task matches a skill listed under Available skills in the system prompt.",
    "Pass the skill name exactly. Relative paths in the skill (scripts/, references/) are relative to the skill base directory.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill name from Available skills",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) throw new Error("name is required");

    const info = findSkill(name, { workspace: ctx.workspace });
    if (!info) {
      const available = listModelSkills({ workspace: ctx.workspace })
        .map((s) => s.name)
        .join(", ");
      throw new Error(
        `Skill "${name}" not found. Available skills: ${available || "none"}`,
      );
    }
    if (info.disableModelInvocation) {
      throw new Error(
        `Skill "${name}" is not model-invocable (disable-model-invocation).`,
      );
    }

    // Fresh read (OpenCode: avoid stale startup cache while authoring skills).
    let body: string;
    try {
      const raw = fs.readFileSync(info.location, "utf8");
      body = parseSkillMarkdown(raw).content.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read skill file: ${message}`);
    }
    if (!body) {
      throw new Error(`Skill "${name}" has an empty body`);
    }

    const files = listCompanionFiles(info.directory, info.location);
    const lines = [
      `<skill_content name="${name}">`,
      `# Skill: ${name}`,
      "",
      body,
      "",
      `Base directory for this skill: ${info.directory}`,
      "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
      "Note: file list is sampled.",
      "",
      "<skill_files>",
      files.length > 0 ? files.map((f) => `  ${f}`).join("\n") : "  (none)",
      "</skill_files>",
      "</skill_content>",
    ];

    return {
      output: truncateOutput(lines.join("\n"), MAX_SKILL_CHARS),
    };
  },
};

function listCompanionFiles(directory: string, skillFile: string): string[] {
  const skillAbs = path.resolve(skillFile);
  const out: string[] = [];
  try {
    walk(directory, out, skillAbs, 0);
  } catch {
    // ignore
  }
  return out.slice(0, MAX_LISTED_FILES);
}

function walk(
  dir: string,
  out: string[],
  skillAbs: string,
  depth: number,
): void {
  if (out.length >= MAX_LISTED_FILES || depth > 3) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= MAX_LISTED_FILES) break;
    if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
    const full = path.join(dir, ent.name);
    if (path.resolve(full) === skillAbs) continue;
    if (ent.isFile()) {
      out.push(full);
    } else if (ent.isDirectory()) {
      walk(full, out, skillAbs, depth + 1);
    }
  }
}
