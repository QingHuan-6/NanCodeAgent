import {
  formatTodoListForModel,
  normalizeTodos,
  persistTodos,
  setTodos,
  summarizeTodos,
} from "../session/todo.js";
import type { ToolDefinition } from "./types.js";

/**
 * Session checklist tool (OpenCode todowrite / Claude TodoWrite style).
 * Replaces the entire list each call.
 */
export const todoWriteTool: ToolDefinition = {
  name: "todo_write",
  description: [
    "Create or replace the structured task list for this coding session.",
    "Use for complex multi-step work (≥3 distinct steps), user-provided task lists, or after new instructions.",
    "Skip for trivial one-step or purely conversational requests.",
    "Keep exactly one item in_progress at a time; mark completed immediately when done;",
    "never mark completed if work is partial or tests are failing.",
    "Each call replaces the full list (send every item, not a diff).",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "Full updated todo list (replaces previous list)",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Stable id (optional; auto-assigned if omitted)",
            },
            content: {
              type: "string",
              description: 'Imperative task text, e.g. "Add login validation"',
            },
            status: {
              type: "string",
              description: "pending | in_progress | completed | cancelled",
            },
            priority: {
              type: "string",
              description: "high | medium | low (default medium)",
            },
          },
          required: ["content", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["todos"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const todos = normalizeTodos(args.todos);
    const sessionId = ctx.sessionId ?? "default";
    setTodos(sessionId, todos);
    persistTodos(ctx.workspace, sessionId, todos);

    return {
      output: formatTodoListForModel(todos),
      ui: {
        todos,
        todoSummary: summarizeTodos(todos),
      },
    };
  },
};
