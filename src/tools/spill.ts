import fs from "node:fs";
import path from "node:path";
import type { ToolContext } from "./types.js";

/** Inline soft limit before spilling to disk. */
export const TOOL_OUTPUT_INLINE_CHARS = 30_000;
/** Chars kept in the model-facing summary after spill. */
export const TOOL_OUTPUT_HEAD_CHARS = 4_000;

/**
 * If output is huge, write the full text under `.nan/tool-output/` and return
 * a short head + pointer so the model can read_file the rest.
 */
export function spillToolOutputIfNeeded(
  text: string,
  ctx: ToolContext,
  toolName: string,
  inlineMax = TOOL_OUTPUT_INLINE_CHARS,
): string {
  if (text.length <= inlineMax) return text;

  const dir = path.join(ctx.workspace, ".nan", "tool-output");
  fs.mkdirSync(dir, { recursive: true });
  const safeName = toolName.replace(/[^\w.-]+/g, "_").slice(0, 40) || "tool";
  const fileName = `${Date.now()}-${safeName}.txt`;
  const absolute = path.join(dir, fileName);
  fs.writeFileSync(absolute, text, "utf8");

  const rel = path.relative(ctx.workspace, absolute).replace(/\\/g, "/");
  const head = text.slice(0, TOOL_OUTPUT_HEAD_CHARS);
  return [
    head,
    "",
    `…[output truncated for context: ${text.length} chars total]`,
    `Full output saved to: ${rel}`,
    `Use read_file on that path (with offset/limit) if you need more.`,
  ].join("\n");
}
