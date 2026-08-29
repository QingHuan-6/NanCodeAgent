import { structuredPatch } from "diff";
import type { ToolUiDiff, ToolUiDiffLine } from "../agent/events.js";

const MAX_DIFF_LINES = 120;

/** Build a capped unified-style diff for the TUI (+/− coloring). */
export function buildFileDiffUi(
  filePath: string,
  before: string,
  after: string,
): ToolUiDiff {
  if (before === after) {
    return { path: filePath, lines: [{ kind: "header", text: "(no changes)" }] };
  }

  const patch = structuredPatch(
    filePath,
    filePath,
    before,
    after,
    undefined,
    undefined,
    { context: 3 },
  );

  const lines: ToolUiDiffLine[] = [
    {
      kind: "header",
      text: before.length === 0 ? `created ${filePath}` : `modified ${filePath}`,
    },
  ];

  for (const hunk of patch.hunks) {
    lines.push({
      kind: "header",
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    });
    for (const raw of hunk.lines) {
      if (raw.startsWith("+")) {
        lines.push({ kind: "add", text: raw.slice(1) });
      } else if (raw.startsWith("-")) {
        lines.push({ kind: "remove", text: raw.slice(1) });
      } else if (raw.startsWith("\\")) {
        lines.push({ kind: "context", text: raw });
      } else {
        // context lines are prefixed with a space
        lines.push({
          kind: "context",
          text: raw.startsWith(" ") ? raw.slice(1) : raw,
        });
      }
      if (lines.length >= MAX_DIFF_LINES) {
        lines.push({ kind: "header", text: "… diff truncated …" });
        return { path: filePath, lines };
      }
    }
  }

  return { path: filePath, lines };
}
