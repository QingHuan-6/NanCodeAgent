import { describe, expect, it } from "vitest";
import {
  filterSlashSuggestions,
  SLASH_SUGGESTIONS,
} from "../../src/cli/slash-suggest.js";

describe("slash suggestions", () => {
  it("lists all when only /", () => {
    expect(filterSlashSuggestions("/")).toEqual(SLASH_SUGGESTIONS);
  });

  it("filters by prefix", () => {
    const hits = filterSlashSuggestions("/re");
    expect(hits.map((h) => h.name)).toEqual(["resume"]);
  });

  it("hides after first space (args)", () => {
    expect(filterSlashSuggestions("/resume ")).toEqual([]);
    expect(filterSlashSuggestions("/web off")).toEqual([]);
  });

  it("includes web", () => {
    expect(SLASH_SUGGESTIONS.some((s) => s.name === "web")).toBe(true);
  });
});
