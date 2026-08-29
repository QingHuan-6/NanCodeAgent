import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseEnvFile,
  writeUserEnv,
  userConfigDir,
} from "../../src/config/env.js";

describe("user env config", () => {
  const originalHome = process.env.USERPROFILE ?? process.env.HOME;
  let fakeHome = "";

  afterEach(() => {
    if (fakeHome && fs.existsSync(fakeHome)) {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
    if (originalHome) {
      process.env.USERPROFILE = originalHome;
      process.env.HOME = originalHome;
    }
    fakeHome = "";
  });

  it("parses env files", () => {
    const parsed = parseEnvFile(
      '# c\nNAN_API_KEY=abc\nNAN_MODEL="m1"\n\n',
    );
    expect(parsed.NAN_API_KEY).toBe("abc");
    expect(parsed.NAN_MODEL).toBe("m1");
  });

  it("writes ~/.nan-agent/.env under the user home", () => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "nan-home-"));
    process.env.USERPROFILE = fakeHome;
    process.env.HOME = fakeHome;

    const file = writeUserEnv({
      NAN_API_KEY: "sk-test",
      NAN_BASE_URL: "https://example.com/v1",
      NAN_MODEL: "demo",
    });

    expect(file).toBe(path.join(fakeHome, ".nan-agent", ".env"));
    expect(userConfigDir()).toBe(path.join(fakeHome, ".nan-agent"));
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("NAN_API_KEY=sk-test");
    expect(text).toContain("NAN_MODEL=demo");
  });
});
