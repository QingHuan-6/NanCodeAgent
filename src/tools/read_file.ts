import fs from "node:fs";
import {
  assertTextFileReadable,
  formatNumberedLines,
  optionalNumber,
  requireString,
  resolveWorkspacePath,
  truncateOutput,
} from "./helpers.js";
import type { ToolDefinition } from "./types.js";

/**
 * Read a text file under the workspace.
 * Optional offset (0-based line) and limit (line count).
 */
export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "Read a text file under the workspace. Returns numbered lines. Optional offset (0-based start line) and limit (max lines).",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to workspace or absolute within workspace",
      },
      offset: {
        type: "number",
        description: "0-based line index to start from (default 0)",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to return (default: all)",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const filePath = requireString(args, "path");
    const offset = optionalNumber(args, "offset") ?? 0;
    const limit = optionalNumber(args, "limit");

    if (offset < 0) throw new Error("offset must be >= 0");
    if (limit !== undefined && limit <= 0) {
      throw new Error("limit must be > 0 when provided");
    }

    const absolute = resolveWorkspacePath(ctx, filePath);
    if (!fs.existsSync(absolute)) {
      throw new Error(`File not found: ${filePath}`);
    }
    assertTextFileReadable(absolute);

    const raw = fs.readFileSync(absolute, "utf8");
    const lines = raw.split(/\r?\n/);
    // Preserve trailing empty line semantics of split; if file ends with \n,
    // last element is "" — keep it so line count matches editors.
    const start = Math.min(Math.floor(offset), lines.length);
    const end =
      limit === undefined
        ? lines.length
        : Math.min(start + Math.floor(limit), lines.length);
    const slice = lines.slice(start, end);
    const body = formatNumberedLines(slice, start + 1);

    const header = [
      `path: ${absolute}`,
      `lines: ${start + 1}-${end} of ${lines.length}`,
      "",
    ].join("\n");

    return { output: truncateOutput(header + body) };
  },
};
