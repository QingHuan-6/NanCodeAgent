/**
 * Session-scoped task checklist (OpenCode todowrite / Claude TodoWrite style).
 * Full-list replace semantics; optionally persisted under .nan/
 */

import fs from "node:fs";
import path from "node:path";

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

const STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

const PRIORITIES = new Set<TodoPriority>(["high", "medium", "low"]);

/** In-memory lists keyed by session id. */
const lists = new Map<string, TodoItem[]>();

export function getTodos(sessionId: string): TodoItem[] {
  return (lists.get(sessionId) ?? []).map((t) => ({ ...t }));
}

export function setTodos(sessionId: string, todos: TodoItem[]): TodoItem[] {
  const copy = todos.map((t) => ({ ...t }));
  lists.set(sessionId, copy);
  return getTodos(sessionId);
}

export function clearTodos(sessionId: string): void {
  lists.delete(sessionId);
}

/**
 * Normalize raw tool args into a validated todo list.
 * If multiple items are in_progress, keep only the last one in_progress
 * (others demoted to pending) — matches "ONE at a time" UX.
 */
export function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) {
    throw new Error("todos must be an array");
  }
  if (raw.length === 0) {
    return [];
  }
  if (raw.length > 40) {
    throw new Error("todos list too long (max 40)");
  }

  const items: TodoItem[] = raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`todos[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const content =
      typeof row.content === "string" ? row.content.trim() : "";
    if (!content) {
      throw new Error(`todos[${index}].content must be a non-empty string`);
    }
    if (content.length > 200) {
      throw new Error(`todos[${index}].content too long (max 200 chars)`);
    }

    const statusRaw =
      typeof row.status === "string" ? row.status.trim() : "pending";
    if (!STATUSES.has(statusRaw as TodoStatus)) {
      throw new Error(
        `todos[${index}].status must be pending|in_progress|completed|cancelled`,
      );
    }

    const priorityRaw =
      typeof row.priority === "string" ? row.priority.trim() : "medium";
    if (!PRIORITIES.has(priorityRaw as TodoPriority)) {
      throw new Error(
        `todos[${index}].priority must be high|medium|low`,
      );
    }

    const id =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim().slice(0, 64)
        : `t${index + 1}`;

    return {
      id,
      content,
      status: statusRaw as TodoStatus,
      priority: priorityRaw as TodoPriority,
    };
  });

  const inProgressIdx = items
    .map((t, i) => (t.status === "in_progress" ? i : -1))
    .filter((i) => i >= 0);
  if (inProgressIdx.length > 1) {
    const keep = inProgressIdx[inProgressIdx.length - 1]!;
    for (const i of inProgressIdx) {
      if (i !== keep) items[i]!.status = "pending";
    }
  }

  return items;
}

export function summarizeTodos(todos: TodoItem[]): string {
  const open = todos.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  ).length;
  const done = todos.filter((t) => t.status === "completed").length;
  const doing = todos.filter((t) => t.status === "in_progress").length;
  if (todos.length === 0) return "0 todos";
  return `${todos.length} todos · ${done} done · ${doing} doing · ${open} open`;
}

export function formatTodoListForModel(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return "Todo list cleared.";
  }
  const lines = todos.map((t, i) => {
    const mark =
      t.status === "completed"
        ? "[x]"
        : t.status === "in_progress"
          ? "[~]"
          : t.status === "cancelled"
            ? "[-]"
            : "[ ]";
    return `${i + 1}. ${mark} ${t.content} (${t.status}, ${t.priority}, id=${t.id})`;
  });
  return [`Updated todos (${summarizeTodos(todos)}):`, ...lines].join("\n");
}

/** Persist under workspace/.nan/todos-<sessionId>.json (best-effort). */
export function persistTodos(
  workspace: string,
  sessionId: string,
  todos: TodoItem[],
): void {
  try {
    const dir = path.join(workspace, ".nan");
    fs.mkdirSync(dir, { recursive: true });
    const safe = sessionId.replace(/[^\w.-]+/g, "_").slice(0, 80);
    const file = path.join(dir, `todos-${safe}.json`);
    fs.writeFileSync(
      file,
      `${JSON.stringify({ sessionId, todos, updatedAt: Date.now() }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // ignore
  }
}

export function loadPersistedTodos(
  workspace: string,
  sessionId: string,
): TodoItem[] | null {
  try {
    const safe = sessionId.replace(/[^\w.-]+/g, "_").slice(0, 80);
    const file = path.join(workspace, ".nan", `todos-${safe}.json`);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      todos?: unknown;
    };
    if (!raw.todos) return null;
    const todos = normalizeTodos(raw.todos);
    setTodos(sessionId, todos);
    return getTodos(sessionId);
  } catch {
    return null;
  }
}
