import type { ToolUiDiff } from "../../agent/events.js";

export type StatusPhase = "idle" | "thinking" | "streaming" | "tool" | "ask";

export interface StatusState {
  phase: StatusPhase;
  detail?: string;
}

export type TranscriptItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "system"; text: string }
  | {
      id: string;
      kind: "tool";
      toolName: string;
      argsSummary: string;
      output?: string;
      isError?: boolean;
      diff?: ToolUiDiff;
    }
  | { id: string; kind: "error"; text: string };

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
  const json = JSON.stringify(args);
  return json.length > 100 ? `${json.slice(0, 100)}…` : json;
}
