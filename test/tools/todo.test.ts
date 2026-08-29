import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearTodos,
  getTodos,
  normalizeTodos,
  summarizeTodos,
} from "../../src/session/todo.js";
import {
  createDefaultRegistry,
  createPlanRegistry,
} from "../../src/tools/index.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";

describe("todo_write", () => {
  let dir = "";

  afterEach(() => {
    if (dir) removeTempDir(dir);
    dir = "";
    clearTodos("test-session");
    clearTodos("default");
  });

  it("normalizes and demotes extra in_progress items", () => {
    const todos = normalizeTodos([
      { content: "A", status: "in_progress" },
      { content: "B", status: "in_progress", priority: "high" },
      { content: "C", status: "pending" },
    ]);
    expect(todos[0]!.status).toBe("pending");
    expect(todos[1]!.status).toBe("in_progress");
    expect(todos[1]!.priority).toBe("high");
    expect(todos[2]!.id).toBe("t3");
  });

  it("rejects invalid status", () => {
    expect(() =>
      normalizeTodos([{ content: "x", status: "done" }]),
    ).toThrow(/status/);
  });

  it("replaces the session list and persists under .nan", async () => {
    dir = createTempDir();
    const tools = createDefaultRegistry();
    const result = await tools.run(
      "todo_write",
      {
        todos: [
          {
            id: "a",
            content: "Scaffold module",
            status: "in_progress",
            priority: "high",
          },
          { id: "b", content: "Add tests", status: "pending" },
        ],
      },
      { workspace: dir, sessionId: "test-session" },
    );

    expect(result.output).toContain("Scaffold module");
    expect(result.ui?.todos).toHaveLength(2);
    expect(result.ui?.todoSummary).toContain("2 todos");
    expect(getTodos("test-session")).toHaveLength(2);
    expect(
      fs.existsSync(path.join(dir, ".nan", "todos-test-session.json")),
    ).toBe(true);

    await tools.run(
      "todo_write",
      {
        todos: [
          { id: "a", content: "Scaffold module", status: "completed" },
          { id: "b", content: "Add tests", status: "in_progress" },
        ],
      },
      { workspace: dir, sessionId: "test-session" },
    );
    expect(getTodos("test-session")[1]!.status).toBe("in_progress");
    expect(summarizeTodos(getTodos("test-session"))).toMatch(/1 doing/);
  });

  it("is available in plan mode registry", () => {
    const plan = createPlanRegistry();
    expect(plan.has("todo_write")).toBe(true);
    expect(plan.has("bash")).toBe(false);
  });
});
