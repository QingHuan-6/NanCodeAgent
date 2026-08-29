import fs from "node:fs";
import { buildFileDiffUi } from "./diff-ui.js";
import {
  assertTextFileReadable,
  optionalBoolean,
  requireString,
  resolveWorkspacePath,
  truncateOutput,
} from "./helpers.js";
import type { ToolDefinition } from "./types.js";

/**
 * Exact string replacement in a file.
 * By default old_string must match exactly once; set replace_all to replace every occurrence.
 */
export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description:
    "Replace an exact string in a file under the workspace. old_string must match uniquely unless replace_all is true. Prefer enough surrounding context to keep the match unique.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to workspace or absolute within workspace",
      },
      old_string: {
        type: "string",
        description: "Exact text to find",
      },
      new_string: {
        type: "string",
        description: "Replacement text",
      },
      replace_all: {
        type: "boolean",
        description: "If true, replace every occurrence (default false)",
      },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const filePath = requireString(args, "path");
    const oldString = requireString(args, "old_string");
    const newString = requireString(args, "new_string");
    const replaceAll = optionalBoolean(args, "replace_all") ?? false;

    if (oldString === newString) {
      throw new Error("old_string and new_string must differ");
    }
    if (oldString.length === 0) {
      throw new Error("old_string must not be empty");
    }

    const absolute = resolveWorkspacePath(ctx, filePath);
    if (!fs.existsSync(absolute)) {
      throw new Error(`File not found: ${filePath}`);
    }
    assertTextFileReadable(absolute);

    const original = fs.readFileSync(absolute, "utf8");
    const count = countOccurrences(original, oldString);
    if (count === 0) {
      throw new Error(
        "old_string not found in file. Read the file again and use an exact contiguous substring.",
      );
    }
    if (!replaceAll && count > 1) {
      throw new Error(
        `old_string matched ${count} times; provide more context for a unique match, or set replace_all=true.`,
      );
    }

    const updated = replaceAll
      ? original.split(oldString).join(newString)
      : original.replace(oldString, newString);

    fs.writeFileSync(absolute, updated, "utf8");

    const replaced = replaceAll ? count : 1;
    const preview = snippetAroundChange(original, updated, oldString, newString);

    return {
      output: truncateOutput(
        [
          `edited: ${absolute}`,
          `replacements: ${replaced}`,
          "",
          preview,
        ].join("\n"),
      ),
      ui: {
        diff: buildFileDiffUi(absolute, original, updated),
      },
    };
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

function snippetAroundChange(
  original: string,
  updated: string,
  oldString: string,
  newString: string,
): string {
  const idx = original.indexOf(oldString);
  if (idx < 0) return "(no preview)";
  const before = original.slice(Math.max(0, idx - 80), idx);
  const afterStart = idx + oldString.length;
  const after = original.slice(afterStart, afterStart + 80);
  return [
    "context:",
    `…${before}⟦-${oldString.length} chars / +${newString.length} chars⟧${after}…`,
    `bytes: ${Buffer.byteLength(original, "utf8")} → ${Buffer.byteLength(updated, "utf8")}`,
  ].join("\n");
}
