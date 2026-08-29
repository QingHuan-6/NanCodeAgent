import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../../src/tools/index.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";

describe("tools", () => {
  let dir = "";

  afterEach(() => {
    if (dir) removeTempDir(dir);
    dir = "";
  });

  function ctx() {
    dir = createTempDir();
    return { workspace: dir };
  }

  describe("write_file / read_file", () => {
    it("writes, creates parents, and reads numbered lines", async () => {
      const tools = createDefaultRegistry();
      const c = ctx();

      const written = await tools.run(
        "write_file",
        { path: "src/hello.txt", content: "one\ntwo\nthree\n" },
        c,
      );
      expect(written.output).toContain("created");
      expect(written.ui?.diff?.lines.some((l) => l.kind === "add")).toBe(true);
      expect(fs.existsSync(path.join(dir, "src/hello.txt"))).toBe(true);

      const read = await tools.run(
        "read_file",
        { path: "src/hello.txt", offset: 1, limit: 1 },
        c,
      );
      expect(read.output).toContain("2|two");
      expect(read.output).toContain("lines: 2-2");
    });

    it("rejects paths that escape the workspace", async () => {
      const tools = createDefaultRegistry();
      const c = ctx();
      const result = await tools.run(
        "read_file",
        { path: "../outside.txt" },
        c,
      );
      expect(result.output).toMatch(/escapes workspace|failed/i);
    });
  });

  describe("edit_file", () => {
    it("replaces a unique string", async () => {
      const tools = createDefaultRegistry();
      const c = ctx();
      await tools.run(
        "write_file",
        { path: "a.txt", content: "hello world\n" },
        c,
      );
      const edited = await tools.run(
        "edit_file",
        { path: "a.txt", old_string: "world", new_string: "nan" },
        c,
      );
      expect(edited.output).toContain("replacements: 1");
      expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe(
        "hello nan\n",
      );
    });

    it("rejects non-unique matches unless replace_all", async () => {
      const tools = createDefaultRegistry();
      const c = ctx();
      await tools.run(
        "write_file",
        { path: "a.txt", content: "aa aa aa" },
        c,
      );
      const denied = await tools.run(
        "edit_file",
        { path: "a.txt", old_string: "aa", new_string: "bb" },
        c,
      );
      expect(denied.output).toMatch(/matched 3 times|failed/i);

      const ok = await tools.run(
        "edit_file",
        {
          path: "a.txt",
          old_string: "aa",
          new_string: "bb",
          replace_all: true,
        },
        c,
      );
      expect(ok.output).toContain("replacements: 3");
      expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("bb bb bb");
    });
  });

  describe("bash", () => {
    it("runs a command in the workspace and returns exit code", async () => {
      const tools = createDefaultRegistry();
      const c = ctx();
      const result = await tools.run(
        "bash",
        { command: "echo smoke-ok" },
        c,
      );
      expect(result.output).toContain("exit_code: 0");
      expect(result.output).toContain("smoke-ok");
    });
  });
});
