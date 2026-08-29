import { describe, expect, it } from "vitest";
import { helpText, parseSlashCommand } from "../../src/cli/slash.js";

describe("slash commands", () => {
  it("returns null for normal prompts", () => {
    expect(parseSlashCommand("fix hello.py")).toBeNull();
  });

  it("parses exit aliases", () => {
    expect(parseSlashCommand("/exit")).toEqual({ type: "exit" });
    expect(parseSlashCommand("/quit")).toEqual({ type: "exit" });
    expect(parseSlashCommand("  /q  ")).toEqual({ type: "exit" });
  });

  it("parses help / clear / status / setup / continue / compact / resume", () => {
    expect(parseSlashCommand("/help")).toEqual({ type: "help" });
    expect(parseSlashCommand("/clear")).toEqual({ type: "clear" });
    expect(parseSlashCommand("/status")).toEqual({ type: "status" });
    expect(parseSlashCommand("/setup")).toEqual({ type: "setup" });
    expect(parseSlashCommand("/config")).toEqual({ type: "setup" });
    expect(parseSlashCommand("/continue")).toEqual({ type: "continue" });
    expect(parseSlashCommand("/compact")).toEqual({ type: "compact" });
    expect(parseSlashCommand("/resume abc")).toEqual({
      type: "resume",
      id: "abc",
    });
    expect(parseSlashCommand("/sessions")).toEqual({ type: "sessions" });
  });

  it("flags unknown commands", () => {
    expect(parseSlashCommand("/foo")).toEqual({
      type: "unknown",
      name: "foo",
    });
  });

  it("includes core commands in help text", () => {
    const text = helpText();
    expect(text).toContain("/help");
    expect(text).toContain("/setup");
    expect(text).toContain("/exit");
    expect(text).toContain("/clear");
    expect(text).toContain("/continue");
    expect(text).toContain("/compact");
    expect(text).toContain("Steer");
  });
});
