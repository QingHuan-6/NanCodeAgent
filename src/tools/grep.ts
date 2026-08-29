import fs from "node:fs";
import path from "node:path";
import {
  assertTextFileReadable,
  optionalBoolean,
  optionalNumber,
  requireString,
  resolveWorkspacePath,
} from "./helpers.js";
import { compileGlob } from "./glob.js";
import type { ToolDefinition } from "./types.js";

const DEFAULT_MAX_MATCHES = 100;
const MAX_FILE_BYTES = 512 * 1024;
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

/** Search file contents under the workspace with a regex. */
export const grepTool: ToolDefinition = {
  name: "grep",
  description:
    "Search file contents under the workspace with a JavaScript regex. Returns path:line:text. Prefer this over shell grep for workspace search.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "JavaScript regex source (not /slashes/)",
      },
      path: {
        type: "string",
        description: "File or directory to search (default: workspace root)",
      },
      glob: {
        type: "string",
        description: 'Optional file filter, e.g. "*.ts" or "**/*.{ts,tsx}"',
      },
      case_insensitive: {
        type: "boolean",
        description: "Case-insensitive search (default false)",
      },
      max_matches: {
        type: "number",
        description: `Max matches to return (default ${DEFAULT_MAX_MATCHES})`,
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const pattern = requireString(args, "pattern");
    const rootArg = typeof args.path === "string" ? args.path : ".";
    const fileGlob =
      typeof args.glob === "string" && args.glob.trim()
        ? compileGlob(args.glob.trim().replace(/\\/g, "/"))
        : null;
    const caseInsensitive = optionalBoolean(args, "case_insensitive") ?? false;
    const maxMatches = Math.min(
      optionalNumber(args, "max_matches") ?? DEFAULT_MAX_MATCHES,
      1000,
    );

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseInsensitive ? "i" : undefined);
    } catch (err) {
      throw new Error(
        `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const root = resolveWorkspacePath(ctx, rootArg);
    if (!fs.existsSync(root)) {
      throw new Error(`Path not found: ${rootArg}`);
    }

    const matches: string[] = [];
    const visitFile = (absolute: string): boolean => {
      const rel = path.relative(ctx.workspace, absolute).replace(/\\/g, "/");
      if (fileGlob && !fileGlob(rel)) return false;
      try {
        assertTextFileReadable(absolute);
      } catch {
        return false;
      }
      let text: string;
      try {
        const stat = fs.statSync(absolute);
        if (stat.size > MAX_FILE_BYTES) return false;
        text = fs.readFileSync(absolute, "utf8");
      } catch {
        return false;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!regex.test(line)) continue;
        // reset lastIndex for global-less reuse
        regex.lastIndex = 0;
        matches.push(`${rel}:${i + 1}:${line}`);
        if (matches.length >= maxMatches) return true;
      }
      return false;
    };

    const stop = { value: false };
    const walk = (dir: string) => {
      if (stop.value) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (stop.value) return;
        if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;
        const absolute = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(absolute);
        else if (ent.isFile() && visitFile(absolute)) stop.value = true;
      }
    };

    const stat = fs.statSync(root);
    if (stat.isFile()) {
      visitFile(root);
    } else {
      walk(root);
    }

    if (matches.length === 0) {
      return { output: `No matches for /${pattern}/${caseInsensitive ? "i" : ""}` };
    }
    const capped = matches.length >= maxMatches;
    return {
      output: [
        `matches: ${matches.length}${capped ? ` (capped at ${maxMatches})` : ""}`,
        ...matches,
      ].join("\n"),
    };
  },
};
