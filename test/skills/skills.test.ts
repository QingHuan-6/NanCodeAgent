import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/prompt.js";
import {
  discoverSkills,
  formatSkillsPromptSection,
  listModelSkills,
  parseSkillMarkdown,
} from "../../src/skills/index.js";
import { createDefaultRegistry, createPlanRegistry } from "../../src/tools/index.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";

describe("parseSkillMarkdown", () => {
  it("parses frontmatter and body", () => {
    const parsed = parseSkillMarkdown(
      `---\nname: demo-skill\ndescription: Does a thing\ndisable-model-invocation: false\n---\n\n# Hello\n\nBody here.\n`,
    );
    expect(parsed.data.name).toBe("demo-skill");
    expect(parsed.data.description).toBe("Does a thing");
    expect(parsed.content).toContain("Body here");
  });
});

describe("discoverSkills", () => {
  let dir = "";

  afterEach(() => {
    if (dir) removeTempDir(dir);
    dir = "";
  });

  it("loads bundled package skills from any workspace cwd", () => {
    dir = createTempDir();
    const skills = listModelSkills({
      workspace: dir,
      includeGlobal: false,
      includeBundled: true,
    });
    const names = skills.map((s) => s.name);
    expect(names).toContain("skill-creator");
    expect(names).toContain("commit-message");
  });

  it("finds bundle and flat skills; project overrides; hides disabled from catalog", () => {
    dir = createTempDir();
    const root = path.join(dir, ".nan", "skills");
    fs.mkdirSync(path.join(root, "alpha-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "alpha-skill", "SKILL.md"),
      `---\nname: alpha-skill\ndescription: Alpha workflow\n---\n\nAlpha body.\n`,
    );
    fs.writeFileSync(
      path.join(root, "beta-skill.md"),
      `---\nname: beta-skill\ndescription: Beta flat\n---\n\nBeta body.\n`,
    );
    fs.mkdirSync(path.join(root, "secret-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "secret-skill", "SKILL.md"),
      `---\nname: secret-skill\ndescription: Hidden\ndisable-model-invocation: true\n---\n\nSecret.\n`,
    );
    fs.writeFileSync(
      path.join(root, "alpha-skill", "reference.md"),
      "extra notes\n",
    );

    const opts = {
      workspace: dir,
      includeGlobal: false,
      includeBundled: false,
    };
    const all = discoverSkills(opts);
    expect(all.map((s) => s.name).sort()).toEqual([
      "alpha-skill",
      "beta-skill",
      "secret-skill",
    ]);

    const catalog = listModelSkills(opts);
    expect(catalog.map((s) => s.name).sort()).toEqual([
      "alpha-skill",
      "beta-skill",
    ]);

    const section = formatSkillsPromptSection(opts);
    expect(section).toContain("alpha-skill");
    expect(section).toContain("Beta flat");
    expect(section).not.toContain("secret-skill");
  });
});

describe("skill tool", () => {
  let dir = "";

  afterEach(() => {
    if (dir) removeTempDir(dir);
    dir = "";
  });

  it("loads body and companion files; fails clearly when missing", async () => {
    dir = createTempDir();
    const skillDir = path.join(dir, ".agents", "skills", "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: demo-skill\ndescription: Demo\n---\n\nDo the demo carefully.\n`,
    );
    fs.writeFileSync(path.join(skillDir, "notes.md"), "side file\n");

    const tools = createDefaultRegistry();
    const result = await tools.run(
      "skill",
      { name: "demo-skill" },
      { workspace: dir },
    );
    expect(result.output).toContain("<skill_content name=\"demo-skill\">");
    expect(result.output).toContain("Do the demo carefully.");
    expect(result.output).toContain("notes.md");

    const missing = await tools.run(
      "skill",
      { name: "nope" },
      { workspace: dir },
    );
    expect(missing.output).toMatch(/not found/i);

    expect(createPlanRegistry().has("skill")).toBe(true);

    const prompt = buildSystemPrompt({ workspace: dir });
    expect(prompt).toContain("# Available skills");
    expect(prompt).toContain("demo-skill");
  });

  it("re-reads SKILL.md from disk on each call", async () => {
    dir = createTempDir();
    const skillDir = path.join(dir, ".nan", "skills", "live-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(
      skillPath,
      `---\nname: live-skill\ndescription: Live\n---\n\nVersion one.\n`,
    );

    const tools = createDefaultRegistry();
    const first = await tools.run(
      "skill",
      { name: "live-skill" },
      { workspace: dir },
    );
    expect(first.output).toContain("Version one.");

    fs.writeFileSync(
      skillPath,
      `---\nname: live-skill\ndescription: Live\n---\n\nVersion two.\n`,
    );
    const second = await tools.run(
      "skill",
      { name: "live-skill" },
      { workspace: dir },
    );
    expect(second.output).toContain("Version two.");
  });
});
