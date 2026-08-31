import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveSessionId,
  shortSessionId,
} from "../../src/session/resolve-id.js";

describe("resolveSessionId", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeDir(ids: string[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nan-sess-"));
    dirs.push(dir);
    for (const id of ids) {
      fs.writeFileSync(path.join(dir, `${id}.jsonl`), "", "utf8");
    }
    return dir;
  }

  it("resolves full id and bare suffix", () => {
    const dir = makeDir(["session-abc123", "session-def456"]);
    expect(resolveSessionId("session-abc123", dir)).toBe("session-abc123");
    expect(resolveSessionId("abc123", dir)).toBe("session-abc123");
    expect(resolveSessionId("def456", dir)).toBe("session-def456");
  });

  it("throws when ambiguous", () => {
    const dir = makeDir(["session-foo-1", "session-foo-2"]);
    expect(() => resolveSessionId("foo", dir)).toThrow(/Ambiguous/);
  });

  it("shortSessionId strips prefix", () => {
    expect(shortSessionId("session-xyz")).toBe("xyz");
    expect(shortSessionId("xyz")).toBe("xyz");
  });
});
