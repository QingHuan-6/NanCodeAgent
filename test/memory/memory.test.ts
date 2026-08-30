import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/prompt.js";
import {
  applyMemorySlash,
  formatMemoryPromptSection,
  isAutoMemoryEnabled,
  loadMemoryIndexForPrompt,
  memoryIndexPath,
  parseMemorySlashArg,
  projectMemoryDir,
  resolveMemoryFile,
  userSettingsPath,
} from "../../src/memory/index.js";
import { memoryTool } from "../../src/tools/memory.js";
import { createDefaultRegistry } from "../../src/tools/index.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";

const prevHome = process.env.USERPROFILE ?? process.env.HOME;
const prevAuto = process.env.NAN_AUTO_MEMORY;

function setFakeHome(home: string): void {
  process.env.USERPROFILE = home;
  process.env.HOME = home;
}

afterEach(() => {
  if (prevHome) {
    process.env.USERPROFILE = prevHome;
    process.env.HOME = prevHome;
  }
  if (prevAuto === undefined) delete process.env.NAN_AUTO_MEMORY;
  else process.env.NAN_AUTO_MEMORY = prevAuto;
});

describe("memory paths + tool", () => {
  it("keeps resolveMemoryFile inside the memory dir", () => {
    const dir = createTempDir();
    try {
      setFakeHome(dir);
      const ok = resolveMemoryFile(dir, "debugging.md");
      expect(ok.ok).toBe(true);
      const bad = resolveMemoryFile(dir, "../escape.md");
      expect(bad.ok).toBe(false);
    } finally {
      removeTempDir(dir);
    }
  });

  it("writes and reads MEMORY.md via the memory tool", async () => {
    const home = createTempDir();
    const workspace = createTempDir();
    try {
      setFakeHome(home);
      const write = await memoryTool.execute(
        {
          operation: "write",
          path: "MEMORY.md",
          content: "# Index\n\n- See build.md for npm scripts\n",
        },
        { workspace },
      );
      expect(write.output).toMatch(/Wrote MEMORY\.md/);
      expect(fs.existsSync(memoryIndexPath(workspace))).toBe(true);

      const read = await memoryTool.execute(
        { operation: "read", path: "MEMORY.md" },
        { workspace },
      );
      expect(read.output).toContain("npm scripts");

      await memoryTool.execute(
        {
          operation: "write",
          path: "build.md",
          content: "npm test\n",
        },
        { workspace },
      );
      const listed = await memoryTool.execute(
        { operation: "list" },
        { workspace },
      );
      expect(listed.output).toContain("MEMORY.md");
      expect(listed.output).toContain("build.md");
      expect(listed.output).toContain(projectMemoryDir(workspace));
    } finally {
      removeTempDir(home);
      removeTempDir(workspace);
    }
  });

  it("injects MEMORY.md head into the system prompt", () => {
    const home = createTempDir();
    const workspace = createTempDir();
    try {
      setFakeHome(home);
      fs.mkdirSync(projectMemoryDir(workspace), { recursive: true });
      fs.writeFileSync(
        memoryIndexPath(workspace),
        "Prefer pnpm over npm.\n",
        "utf8",
      );
      const section = formatMemoryPromptSection(workspace);
      expect(section).toContain("Prefer pnpm over npm");
      expect(loadMemoryIndexForPrompt(workspace)).toContain("pnpm");

      const prompt = buildSystemPrompt({ workspace });
      expect(prompt).toContain("Auto memory");
      expect(prompt).toContain("Prefer pnpm over npm");
    } finally {
      removeTempDir(home);
      removeTempDir(workspace);
    }
  });

  it("injects ~/.nan-agent/AGENTS.md as user instructions", () => {
    const home = createTempDir();
    const workspace = createTempDir();
    try {
      setFakeHome(home);
      fs.mkdirSync(path.join(home, ".nan-agent"), { recursive: true });
      fs.writeFileSync(
        path.join(home, ".nan-agent", "AGENTS.md"),
        "Always reply in concise Chinese.\n",
        "utf8",
      );
      const prompt = buildSystemPrompt({ workspace });
      expect(prompt).toContain("User instructions");
      expect(prompt).toContain("concise Chinese");
    } finally {
      removeTempDir(home);
      removeTempDir(workspace);
    }
  });

  it("registers memory on the default tool registry", () => {
    expect(createDefaultRegistry().has("memory")).toBe(true);
  });

  it("toggles auto memory via /memory on|off into settings.json", () => {
    const home = createTempDir();
    const workspace = createTempDir();
    try {
      setFakeHome(home);
      delete process.env.NAN_AUTO_MEMORY;
      expect(isAutoMemoryEnabled(workspace)).toBe(true);

      const off = parseMemorySlashArg("off");
      expect(off.kind).toBe("set");
      const text = applyMemorySlash(workspace, off as { kind: "set"; enabled: boolean; scope: "user" });
      expect(text).toMatch(/Auto memory → OFF/);
      expect(isAutoMemoryEnabled(workspace)).toBe(false);
      expect(fs.existsSync(userSettingsPath())).toBe(true);

      applyMemorySlash(workspace, { kind: "set", enabled: true, scope: "user" });
      expect(isAutoMemoryEnabled(workspace)).toBe(true);

      applyMemorySlash(workspace, {
        kind: "set",
        enabled: false,
        scope: "project",
      });
      expect(isAutoMemoryEnabled(workspace)).toBe(false);
      expect(
        fs.existsSync(path.join(workspace, ".nan", "settings.json")),
      ).toBe(true);
    } finally {
      removeTempDir(home);
      removeTempDir(workspace);
    }
  });
});
