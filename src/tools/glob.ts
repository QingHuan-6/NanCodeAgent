import fs from "node:fs";
import path from "node:path";
import {
  optionalNumber,
  requireString,
  resolveWorkspacePath,
} from "./helpers.js";
import type { ToolDefinition } from "./types.js";

const DEFAULT_MAX_RESULTS = 200;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".nan",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
]);

/** Find files under the workspace matching a simple glob. */
export const globTool: ToolDefinition = {
  name: "glob",
  description:
    "Find files under the workspace by glob pattern (supports *, ?, **). Skips node_modules/.git/dist by default. Prefer this over shell find.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: 'Glob pattern, e.g. "**/*.ts" or "src/**/*.py"',
      },
      path: {
        type: "string",
        description: "Directory to search under (default: workspace root)",
      },
      max_results: {
        type: "number",
        description: `Max paths to return (default ${DEFAULT_MAX_RESULTS})`,
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const pattern = requireString(args, "pattern");
    const rootArg = typeof args.path === "string" ? args.path : ".";
    const maxResults = Math.min(
      optionalNumber(args, "max_results") ?? DEFAULT_MAX_RESULTS,
      2000,
    );
    if (!pattern.trim()) throw new Error("pattern must not be empty");

    const root = resolveWorkspacePath(ctx, rootArg);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`Not a directory: ${rootArg}`);
    }

    const matcher = compileGlob(pattern.replace(/\\/g, "/"));
    const hits: string[] = [];
    walk(root, ctx.workspace, (rel) => {
      if (matcher(rel.replace(/\\/g, "/"))) {
        hits.push(rel.replace(/\\/g, "/"));
        return hits.length >= maxResults;
      }
      return false;
    });

    hits.sort((a, b) => a.localeCompare(b));
    if (hits.length === 0) {
      return { output: `No files matched: ${pattern}` };
    }
    const truncated = hits.length >= maxResults;
    return {
      output: [
        `matches: ${hits.length}${truncated ? ` (capped at ${maxResults})` : ""}`,
        ...hits,
      ].join("\n"),
    };
  },
};

function walk(
  dir: string,
  workspace: string,
  onFile: (rel: string) => boolean,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "." || ent.name === "..") continue;
    if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;
    const absolute = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(absolute, workspace, onFile);
    } else if (ent.isFile()) {
      const rel = path.relative(workspace, absolute);
      if (onFile(rel)) return;
    }
  }
}

/** Compile a limited glob to a predicate (**, *, ?). */
export function compileGlob(pattern: string): (path: string) => boolean {
  let normalized = pattern.trim();
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  // "src/*.ts" should not match "src/a/b.ts"
  const regex = globToRegExp(normalized);
  return (p: string) => {
    let target = p;
    if (target.startsWith("./")) target = target.slice(2);
    return regex.test(target);
  };
}

function globToRegExp(glob: string): RegExp {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      // ** or **/
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^$()[]{}|\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re, "i");
}
