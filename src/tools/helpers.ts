import fs from "node:fs";
import path from "node:path";
import { resolveUnderWorkspace } from "../permissions.js";
import type { ToolContext } from "./types.js";

export const MAX_READ_BYTES = 512 * 1024;
export const MAX_WRITE_BYTES = 1024 * 1024;
export const MAX_TOOL_OUTPUT_CHARS = 100_000;
export const DEFAULT_BASH_TIMEOUT_MS = 60_000;

export function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`Missing or invalid string argument: ${key}`);
  }
  return value;
}

export function optionalNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid number argument: ${key}`);
  }
  return value;
}

export function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`Invalid boolean argument: ${key}`);
  }
  return value;
}

/** Resolve a path argument and ensure it stays inside the workspace. */
export function resolveWorkspacePath(
  ctx: ToolContext,
  filePath: string,
): string {
  const resolved = resolveUnderWorkspace(path.resolve(ctx.workspace), filePath);
  if (!resolved.ok) {
    throw new Error(resolved.reason);
  }
  return resolved.absolute;
}

export function assertTextFileReadable(absolute: string): void {
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${absolute}`);
  }
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(
      `File too large to read (${stat.size} bytes, max ${MAX_READ_BYTES})`,
    );
  }
  if (looksBinary(absolute)) {
    throw new Error(`File appears to be binary: ${absolute}`);
  }
}

function looksBinary(absolute: string): boolean {
  const fd = fs.openSync(absolute, "r");
  try {
    const buf = Buffer.alloc(8_192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (let i = 0; i < n; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

/** Truncate long tool output so context stays manageable. */
export function truncateOutput(text: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…[truncated ${text.length - max} chars]`;
}

/** Format file content with 1-based line numbers for the model. */
export function formatNumberedLines(
  lines: string[],
  startLine1Based: number,
): string {
  const width = String(startLine1Based + lines.length - 1).length;
  return lines
    .map((line, i) => {
      const n = String(startLine1Based + i).padStart(width, " ");
      return `${n}|${line}`;
    })
    .join("\n");
}
