import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../../src/cli/tui/markdown.js";

describe("tui markdown parser", () => {
  it("parses headings, lists, and conceals bold markers in the AST", () => {
    const blocks = parseMarkdown(
      [
        "## 综述",
        "",
        "- **A Survey** ([arXiv](https://arxiv.org/abs/2308.11432)) — note",
        "- plain item",
        "",
        "Use `task` sparingly.",
      ].join("\n"),
    );

    expect(blocks[0]).toMatchObject({ kind: "heading", level: 2 });
    expect(blocks.some((b) => b.kind === "list_item")).toBe(true);
    const list = blocks.find((b) => b.kind === "list_item")!;
    expect(list.kind).toBe("list_item");
    if (list.kind === "list_item") {
      expect(list.spans.some((s) => s.kind === "bold" && s.text === "A Survey")).toBe(
        true,
      );
      expect(list.spans.some((s) => s.kind === "link")).toBe(true);
    }
  });

  it("parses fenced code blocks", () => {
    const blocks = parseMarkdown("```ts\nconst x = 1\n```\n");
    expect(blocks[0]).toEqual({
      kind: "code",
      lang: "ts",
      text: "const x = 1",
    });
  });

  it("parseInline handles nested-ish sequences", () => {
    const spans = parseInline("see `foo` and **bar** plus *baz*");
    expect(spans.map((s) => s.kind)).toEqual([
      "text",
      "code",
      "text",
      "bold",
      "text",
      "italic",
    ]);
  });
});
