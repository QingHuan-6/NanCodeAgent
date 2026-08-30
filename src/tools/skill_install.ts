import { pullHttpCatalog } from "../skills/catalog.js";
import {
  syncConfiguredSkillSources,
} from "../skills/discover.js";
import { appendSkillSource } from "../skills/sources.js";
import { assertSafeUrl } from "./web.js";
import type { ToolDefinition } from "./types.js";

/**
 * Register an OpenCode-style skill source (HTTP catalog URL or local dir)
 * into skills.json and sync remote catalogs into the cache.
 */
export const skillInstallTool: ToolDefinition = {
  name: "skill_install",
  description: [
    "Install or register a skill source for NanCodeAgent (OpenCode-compatible).",
    "Pass an https catalog base URL (must serve index.json) or a local directory path.",
    "Writes to .nan/skills.json (project) or ~/.nan-agent/skills.json (global=true),",
    "then pulls HTTP catalogs into ~/.nan-agent/skills-cache/.",
    "After install, skills appear under Available skills on the next turn; load with the skill tool.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description:
          "https://…/skills/ catalog base URL, or a local/~/ relative skills directory",
      },
      global: {
        type: "boolean",
        description:
          "If true, register in ~/.nan-agent/skills.json (all workspaces). Default false (project .nan/skills.json).",
      },
    },
    required: ["source"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const source = typeof args.source === "string" ? args.source.trim() : "";
    if (!source) throw new Error("source is required");
    const global = args.global === true;

    if (/^https?:\/\//i.test(source)) {
      const url = source.endsWith("/") ? source : `${source}/`;
      assertSafeUrl(url);
      // Validate catalog before writing config
      const pulled = await pullHttpCatalog(url);
      const { path: configPath, added } = appendSkillSource(url, {
        workspace: ctx.workspace,
        global,
      });
      // Re-sync all configured (includes this one)
      const sync = await syncConfiguredSkillSources(ctx.workspace);
      return {
        output: [
          `Registered HTTP skill catalog.`,
          `config: ${configPath} (${added ? "added" : "already present"})`,
          `cache: ${pulled.cacheDir}`,
          `skills in this catalog: ${pulled.skillCount}`,
          `sync: ${sync.ok} catalog(s) ok` +
            (sync.failed.length
              ? `; failed: ${sync.failed.join("; ")}`
              : ""),
          `Call the skill tool with a skill name from Available skills on the next turn.`,
        ].join("\n"),
      };
    }

    const { path: configPath, added } = appendSkillSource(source, {
      workspace: ctx.workspace,
      global,
    });
    return {
      output: [
        `Registered local skill directory source.`,
        `config: ${configPath} (${added ? "added" : "already present"})`,
        `source: ${source}`,
        `Ensure the directory contains <name>/SKILL.md (or flat <name>.md).`,
      ].join("\n"),
    };
  },
};
