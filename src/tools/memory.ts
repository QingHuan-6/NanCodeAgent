import fs from "node:fs";
import path from "node:path";
import {
  ensureMemoryDir,
  isAutoMemoryEnabled,
  projectMemoryDir,
  resolveMemoryFile,
} from "../memory/index.js";
import { truncateOutput } from "./helpers.js";
import type { ToolDefinition } from "./types.js";

const MAX_FILE_CHARS = 40_000;

/**
 * Claude-style file memory: list / read / write / append under ~/.nan-agent/projects/<id>/memory/.
 */
export const memoryTool: ToolDefinition = {
  name: "memory",
  description: [
    "Read or update durable auto-memory markdown for this workspace (Claude-style MEMORY.md).",
    "Files live under the user memory directory (not the git repo). Prefer a short MEMORY.md index plus topic files.",
    "operations: list | read | write | append. Default path is MEMORY.md.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "list | read | write | append",
      },
      path: {
        type: "string",
        description: "Relative .md path under the memory dir (default MEMORY.md)",
      },
      content: {
        type: "string",
        description: "Full file body for write, or text to append",
      },
    },
    required: ["operation"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
        if (!isAutoMemoryEnabled(ctx.workspace)) {
      throw new Error(
        "Auto memory is off. Turn it on with /memory on (or unset NAN_AUTO_MEMORY).",
      );
    }

    const op =
      typeof args.operation === "string"
        ? args.operation.trim().toLowerCase()
        : "";
    const rel =
      typeof args.path === "string" && args.path.trim()
        ? args.path.trim()
        : "MEMORY.md";

    if (op === "list") {
      const dir = ensureMemoryDir(ctx.workspace);
      const files = listMarkdown(dir);
      if (files.length === 0) {
        return {
          output: `Memory directory: ${dir}\n(no .md files yet)`,
        };
      }
      return {
        output: [
          `Memory directory: ${dir}`,
          ...files.map((f) => `- ${f}`),
        ].join("\n"),
      };
    }

    const resolved = resolveMemoryFile(ctx.workspace, rel);
    if (!resolved.ok) throw new Error(resolved.reason);

    if (op === "read") {
      if (!fs.existsSync(resolved.absolute)) {
        throw new Error(
          `Memory file not found: ${resolved.relative}. Use memory operation=list.`,
        );
      }
      const text = fs.readFileSync(resolved.absolute, "utf8");
      return {
        output: truncateOutput(
          `# ${resolved.relative}\n\n${text}`,
          MAX_FILE_CHARS,
        ),
      };
    }

    if (op === "write" || op === "append") {
      const content =
        typeof args.content === "string" ? args.content : "";
      if (!content.trim() && op === "write") {
        throw new Error("content is required for write");
      }
      if (!content && op === "append") {
        throw new Error("content is required for append");
      }
      ensureMemoryDir(ctx.workspace);
      fs.mkdirSync(path.dirname(resolved.absolute), { recursive: true });

      if (op === "write") {
        const body = ensureTrailingNewline(content.replace(/\r\n/g, "\n"));
        fs.writeFileSync(resolved.absolute, body, "utf8");
        return {
          output: `Wrote ${resolved.relative} (${body.length} chars) under ${projectMemoryDir(ctx.workspace)}`,
        };
      }

      const prev = fs.existsSync(resolved.absolute)
        ? fs.readFileSync(resolved.absolute, "utf8")
        : "";
      const sep =
        prev && !prev.endsWith("\n") ? "\n" : prev.endsWith("\n\n") ? "" : prev ? "\n" : "";
      const next = ensureTrailingNewline(
        `${prev}${sep}${content.replace(/\r\n/g, "\n")}`,
      );
      fs.writeFileSync(resolved.absolute, next, "utf8");
      return {
        output: `Appended to ${resolved.relative} (now ${next.length} chars)`,
      };
    }

    throw new Error('operation must be "list", "read", "write", or "append"');
  },
};

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (base: string, prefix: string) => {
    for (const name of fs.readdirSync(base).sort()) {
      const abs = path.join(base, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs, rel);
      else if (st.isFile() && name.toLowerCase().endsWith(".md")) out.push(rel);
    }
  };
  walk(dir, "");
  return out;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
