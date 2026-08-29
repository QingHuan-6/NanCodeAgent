import { describe, expect, it } from "vitest";
import {
  createDefaultRegistry,
  createPlanRegistry,
} from "../../src/tools/index.js";
import { assertSafeUrl, htmlToText } from "../../src/tools/web.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";

describe("ask_user", () => {
  it("returns the user answer via askUser handler", async () => {
    const tools = createDefaultRegistry();
    const result = await tools.run(
      "ask_user",
      {
        question: "Which API?",
        options: ["REST", "GraphQL"],
      },
      {
        workspace: process.cwd(),
        askUser: async (req) => {
          expect(req.question).toBe("Which API?");
          expect(req.options).toEqual(["REST", "GraphQL"]);
          return "GraphQL";
        },
      },
    );
    expect(result.output).toContain("GraphQL");
  });

  it("fails clearly when askUser is missing", async () => {
    const tools = createDefaultRegistry();
    const result = await tools.run(
      "ask_user",
      { question: "Hi?" },
      { workspace: process.cwd() },
    );
    expect(result.output).toMatch(/unavailable|askUser/i);
  });
});

describe("web helpers", () => {
  it("blocks private and localhost hosts", () => {
    expect(() => assertSafeUrl("http://127.0.0.1/secret")).toThrow(/Blocked/);
    expect(() => assertSafeUrl("http://localhost/x")).toThrow(/Blocked/);
    expect(() => assertSafeUrl("http://192.168.1.1/")).toThrow(/Blocked/);
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(/http/);
    expect(assertSafeUrl("https://example.com/docs").hostname).toBe(
      "example.com",
    );
  });

  it("strips scripts/styles from HTML", () => {
    const text = htmlToText(
      "<html><head><style>x{}</style></head><body><script>alert(1)</script><p>Hello <b>world</b></p></body></html>",
    );
    expect(text).toContain("Hello");
    expect(text).toContain("world");
    expect(text).not.toMatch(/alert|x\{\}/);
  });
});

describe("lsp tool", () => {
  it("rejects unsupported operations without spawning", async () => {
    const dir = createTempDir();
    try {
      const tools = createDefaultRegistry();
      const result = await tools.run(
        "lsp",
        { operation: "rename", path: "a.ts", line: 1, character: 1 },
        { workspace: dir },
      );
      expect(result.output).toMatch(/Invalid operation/i);
    } finally {
      removeTempDir(dir);
    }
  });
});

describe("registries", () => {
  it("registers ask/web/lsp in agent and plan modes", () => {
    const agent = createDefaultRegistry();
    const plan = createPlanRegistry();
    for (const name of ["ask_user", "web_fetch", "web_search", "lsp"] as const) {
      expect(agent.has(name)).toBe(true);
      expect(plan.has(name)).toBe(true);
    }
    expect(plan.has("bash")).toBe(false);
    expect(plan.has("write_file")).toBe(false);
  });
});
