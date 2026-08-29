import type { ToolUiDiff } from "../../agent/events.js";

export type StatusPhase = "idle" | "thinking" | "streaming" | "tool" | "ask";

export interface StatusState {
  phase: StatusPhase;
  detail?: string;
}

/** One chronological transcript row. */
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
      /** Short subject for the activity line (path / query / command). */
      subject: string;
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

export interface UserQuestionRequest {
  question: string;
  options?: string[];
  resolve: (answer: string) => void;
}

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** Key fragment for activity log (not raw JSON). */
export function toolSubject(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "grep": {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      const glob = typeof args.glob === "string" ? args.glob : "";
      const q = clip(pattern, 60);
      return glob ? `"${q}" in ${glob}` : `"${q}"`;
    }
    case "glob": {
      const pattern = typeof args.pattern === "string" ? args.pattern : "*";
      return clip(pattern, 70);
    }
    case "read_file":
    case "write_file":
    case "edit_file":
      return clip(String(args.path ?? ""), 70);
    case "bash":
      return clip(String(args.command ?? ""), 70);
    case "todo_write": {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      return `${todos.length} item${todos.length === 1 ? "" : "s"}`;
    }
    case "ask_user":
      return clip(String(args.question ?? "question"), 70);
    case "web_fetch":
      return clip(String(args.url ?? ""), 70);
    case "web_search":
      return clip(String(args.query ?? ""), 70);
    case "lsp":
      return clip(
        `${args.operation ?? "lsp"} ${args.path ?? ""}${
          args.line != null ? `:${args.line}` : ""
        }`,
        70,
      );
    default:
      return clip(JSON.stringify(args), 70);
  }
}

/** Progressive: "Searching…" */
export function toolRunningLabel(toolName: string, subject: string): string {
  switch (toolName) {
    case "grep":
      return `Searching for ${subject}`;
    case "glob":
      return `Finding ${subject}`;
    case "read_file":
      return `Reading ${subject}`;
    case "write_file":
      return `Writing ${subject}`;
    case "edit_file":
      return `Editing ${subject}`;
    case "bash":
      return `Running ${subject}`;
    case "todo_write":
      return `Updating todos (${subject})`;
    case "ask_user":
      return `Asking user: ${subject}`;
    case "web_fetch":
      return `Fetching ${subject}`;
    case "web_search":
      return `Searching web for ${subject}`;
    case "lsp":
      return `LSP ${subject}`;
    default:
      return `Running ${toolName} ${subject}`.trim();
  }
}

/** Perfect: "Searched for … · 15 matches" */
export function toolDoneLabel(
  toolName: string,
  subject: string,
  output: string | undefined,
  isError: boolean,
): string {
  if (isError) {
    return `Failed ${toolName}${subject ? ` ${subject}` : ""}`;
  }
  const count = matchCount(output);
  switch (toolName) {
    case "grep":
      return count != null
        ? `Searched for ${subject} · ${count} matches`
        : `Searched for ${subject}`;
    case "glob":
      return count != null
        ? `Found ${count} files · ${subject}`
        : /No files matched/i.test(output ?? "")
          ? `No files · ${subject}`
          : `Found ${subject}`;
    case "read_file":
      return `Read ${subject}${lineHint(output)}`;
    case "write_file":
      return `Wrote ${subject}`;
    case "edit_file":
      return `Edited ${subject}`;
    case "bash":
      return `Ran ${subject}${bashHint(output)}`;
    case "todo_write":
      return `Updated todos (${subject})`;
    case "ask_user":
      return `Asked user: ${subject}`;
    case "web_fetch":
      return `Fetched ${subject}`;
    case "web_search":
      return `Searched web for ${subject}`;
    case "lsp":
      return `LSP ${subject}`;
    default:
      return `Finished ${toolName}${subject ? ` ${subject}` : ""}`;
  }
}

function matchCount(output: string | undefined): number | null {
  if (!output) return null;
  const m = output.match(/matches:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function lineHint(output: string | undefined): string {
  if (!output) return "";
  const lines = countOutputLines(output);
  return lines > 1 ? ` · ${lines} lines` : "";
}

function bashHint(output: string | undefined): string {
  if (!output) return "";
  const m = output.match(/exit_code:\s*(-?\d+)/);
  if (!m) return "";
  return m[1] === "0" ? " · ok" : ` · exit ${m[1]}`;
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export function countOutputLines(output: string): number {
  if (!output) return 0;
  return output.split(/\r?\n/).length;
}
