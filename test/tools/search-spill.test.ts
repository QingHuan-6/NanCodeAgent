import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileGlob } from "../../src/tools/glob.js";
import { createDefaultRegistry, createPlanRegistry } from "../../src/tools/index.js";
import { spillToolOutputIfNeeded } from "../../src/tools/spill.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";

describe("glob / grep tools", () => {
  let dir = "";

  afterEach(() => {
    if (dir) removeTempDir(dir);
    dir = "";
  });

  it("compileGlob matches ** and *", () => {
    const m = compileGlob("**/*.ts");
    expect(m("src/a.ts")).toBe(true);
    expect(m("src/a/b.ts")).toBe(true);
    expect(m("src/a.js")).toBe(false);
  });

  it("glob finds files under workspace", async () => {
    dir = createTempDir();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), " cons");
    fs.writeFileSync(path.join(dir, "src", "b.js"), "x");
    fs.writeFileSync(path.join(dir, "readme.md"), "x");

    const tools = createDefaultRegistry();
    const result = await tools.run(
      "glob",
      { pattern: "**/*.ts" },
      { workspace: dir },
    );
    expect(result.output).toContain("src/a.ts");
    expect(result.output).not.toContain("b.js");
  });

  it("grep finds line matches", async () => {
    dir = createTempDir();
    fs.writeFileSync(path.join(dir, "app.ts"), "const foo = 1;\nconst bar = 2;\n");
    const tools = createDefaultRegistry();
    const result = await tools.run(
      "grep",
      { pattern: "foo", glob: "*.ts" },
      { workspace: dir },
    );
    expect(result.output).toMatch(/app\.ts:1:.*foo/);
    expect(result.output).not.toContain("bar");
  });

  it("plan registry has no write tools", () => {
    const plan = createPlanRegistry();
    expect(plan.has("read_file")).toBe(true);
    expect(plan.has("glob")).toBe(true);
    expect(plan.has("grep")).toBe(true);
    expect(plan.has("write_file")).toBe(false);
    expect(plan.has("bash")).toBe(false);
  });
});

describe("tool output spill", () => {
  let dir = "";
  afterEach(() => {
    if (dir) removeTempDir(dir);
    dir = "";
  });

  it("spills huge output to .nan/tool-output", () => {
    dir = createTempDir();
    const huge = "x".repeat(40_000);
    const out = spillToolOutputIfNeeded(huge, { workspace: dir }, "bash");
    expect(out).toContain("Full output saved to:");
    expect(out.length).toBeLessThan(huge.length);
    const spillDir = path.join(dir, ".nan", "tool-output");
    expect(fs.existsSync(spillDir)).toBe(true);
    const files = fs.readdirSync(spillDir);
    expect(files.length).toBe(1);
    expect(fs.readFileSync(path.join(spillDir, files[0]!), "utf8").length).toBe(
      40_000,
    );
  });
});
