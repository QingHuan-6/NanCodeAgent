import type { ToolUiDiff } from "../../agent/events.js";

export type StatusPhase = "idle" | "thinking" | "streaming" | "tool" | "ask";

export interface StatusState {
  phase: StatusPhase;
  detail?: string;
}

/** One chronological transcript row (Pi / OpenCode style — event order). */
export type TimelineItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "system"; text: string }
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "done"; reason: string; turns: number }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      toolName: string;
      argsSummary: string;
      status: "running" | "done" | "error";
      output?: string;
      diff?: ToolUiDiff;
      expanded: boolean;
    };

export interface PermissionRequest {
  toolName: string;
  reason: string;
  resolve: (allow: boolean) => void;
}

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function summarizeArgs(args: Record<string, unknown>): string {
  // Prefer path/command for scannable one-liners (Claude / OpenCode style).
  if (typeof args.path === "string") {
    const extra =
      typeof args.command === "string"
        ? ""
        : args.content !== undefined
          ? ""
          : "";
    void extra;
    return String(args.path);
  }
  if (typeof args.command === "string") {
    const cmd = args.command;
    return cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd;
  }
  const json = JSON.stringify(args);
  return json.length > 80 ? `${json.slice(0, 80)}…` : json;
}

export function summarizeOutput(output: string, max = 64): string {
  const oneLine = output.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export function countOutputLines(output: string): number {
  if (!output) return 0;
  return output.split(/\r?\n/).length;
}
