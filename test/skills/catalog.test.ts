import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogCacheDir,
  pullHttpCatalog,
  type FetchLike,
} from "../../src/skills/catalog.js";
import {
  discoverSkills,
  listModelSkills,
} from "../../src/skills/discover.js";
import { appendSkillSource, loadSkillSources } from "../../src/skills/sources.js";
import { createDefaultRegistry } from "../../src/tools/index.js";
import { createTempDir, removeTempDir } from "../utils/temp.js";

describe("HTTP skill catalog", () => {
  let dir = "";
  const prevHome = process.env.USERPROFILE ?? process.env.HOME;

  afterEach(() => {
    if (dir) removeTempDir(dir);
    dir = "";
    if (prevHome) {
      process.env.USERPROFILE = prevHome;
      process.env.HOME = prevHome;
    }
    vi.unstubAllGlobals();
  });

  it("pulls index.json + files into cache and discovers the skill", async () => {
    dir = createTempDir();
    process.env.USERPROFILE = dir;
    process.env.HOME = dir;

    const files = new Map<string, string>([
      [
        "https://skills.example.com/catalog/index.json",
        JSON.stringify({
          skills: [
            {
              name: "demo-remote",
              version: "1",
              files: ["demo-remote.md", "references/note.md"],
            },
          ],
        }),
      ],
      [
        "https://skills.example.com/catalog/demo-remote/demo-remote.md",
        `---\nname: demo-remote\ndescription: Remote demo skill\n---\n\nDo remote things.\n`,
      ],
      [
        "https://skills.example.com/catalog/demo-remote/references/note.md",
        "note body\n",
      ],
    ]);

    const fetchImpl: FetchLike = async (url) => {
      const body = files.get(url);
      if (!body) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      const buf = Buffer.from(body, "utf8");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => body,
        arrayBuffer: async () =>
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    };

    const base = "https://skills.example.com/catalog/";
    const result = await pullHttpCatalog(base, { fetchImpl });
    expect(result.skillCount).toBe(1);
    expect(result.cacheDir).toBe(catalogCacheDir(base));
    expect(
      fs.existsSync(path.join(result.cacheDir, "demo-remote", "demo-remote.md")),
    ).toBe(true);

    // Second pull same version should not rewrite
    const again = await pullHttpCatalog(base, { fetchImpl });
    expect(again.updated).toBe(false);

    appendSkillSource(base, { workspace: dir, global: true });
    const sources = loadSkillSources(dir);
    expect(sources.some((s) => s.kind === "http")).toBe(true);

    const found = listModelSkills({
      workspace: dir,
      includeBundled: false,
      includeGlobal: false,
      includeConfigured: true,
    });
    expect(found.map((s) => s.name)).toContain("demo-remote");

    const tools = createDefaultRegistry();
    const loaded = await tools.run(
      "skill",
      { name: "demo-remote" },
      { workspace: dir },
    );
    expect(loaded.output).toContain("Do remote things.");
  });

  it("skill_install registers http catalog via tool", async () => {
    dir = createTempDir();
    process.env.USERPROFILE = dir;
    process.env.HOME = dir;

    const files = new Map<string, string>([
      [
        "https://cdn.example.com/skills/index.json",
        JSON.stringify({
          skills: [
            {
              name: "via-tool",
              version: "2",
              files: ["SKILL.md"],
            },
          ],
        }),
      ],
      [
        "https://cdn.example.com/skills/via-tool/SKILL.md",
        `---\nname: via-tool\ndescription: Installed via tool\n---\n\nTool install body.\n`,
      ],
    ]);

    const fetchImpl: FetchLike = async (url) => {
      const body = files.get(url);
      if (!body) {
        return {
          ok: false,
          status: 404,
          statusText: "NF",
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      const buf = Buffer.from(body, "utf8");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => body,
        arrayBuffer: async () =>
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    };

    // Monkeypatch global fetch used by skill_install → pullHttpCatalog
    vi.stubGlobal("fetch", fetchImpl);

    const tools = createDefaultRegistry();
    const out = await tools.run(
      "skill_install",
      { source: "https://cdn.example.com/skills/", global: true },
      { workspace: dir },
    );
    expect(out.output).toMatch(/Registered HTTP skill catalog/i);
    expect(
      discoverSkills({
        workspace: dir,
        includeBundled: false,
        includeGlobal: false,
      }).some((s) => s.name === "via-tool"),
    ).toBe(true);
  });
});
