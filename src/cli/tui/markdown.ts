/**
 * Lightweight markdown → structured blocks for Ink TUI.
 * Subset: headings, lists, fenced code, paragraphs; inline code/links/bold/italic.
 * Markers are concealed (OpenCode-style) — **x** renders bold without stars.
 */

export type InlineSpan =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; href: string };

export type MdBlock =
  | { kind: "heading"; level: 1 | 2 | 3; spans: InlineSpan[] }
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "list_item"; ordered: boolean; index?: number; spans: InlineSpan[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "blank" };

export function parseMarkdown(source: string): MdBlock[] {
  const text = source.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, "").trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      blocks.push({ kind: "blank" });
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(3, heading[1]!.length) as 1 | 2 | 3;
      blocks.push({
        kind: "heading",
        level,
        spans: parseInline(heading[2]!.trim()),
      });
      i += 1;
      continue;
    }

    const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (ul) {
      blocks.push({
        kind: "list_item",
        ordered: false,
        spans: parseInline(ul[1]!),
      });
      i += 1;
      continue;
    }

    const ol = /^\s*(\d+)\.\s+(.+)$/.exec(line);
    if (ol) {
      blocks.push({
        kind: "list_item",
        ordered: true,
        index: Number(ol[1]),
        spans: parseInline(ol[2]!),
      });
      i += 1;
      continue;
    }

    // Soft-wrap paragraph lines until blank / fence / list / heading
    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!;
      if (
        next.trim() === "" ||
        /^\s*```/.test(next) ||
        /^(#{1,3})\s+/.test(next) ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next)
      ) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({
      kind: "paragraph",
      spans: parseInline(para.join(" ").replace(/\s+/g, " ").trim()),
    });
  }

  return blocks;
}

/** Exported for unit tests. */
export function parseInline(input: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let i = 0;

  const pushText = (t: string) => {
    if (!t) return;
    const last = spans[spans.length - 1];
    if (last?.kind === "text") last.text += t;
    else spans.push({ kind: "text", text: t });
  };

  while (i < input.length) {
    // [label](url)
    if (input[i] === "[") {
      const close = input.indexOf("](", i);
      if (close > i) {
        const end = input.indexOf(")", close + 2);
        if (end > close) {
          const label = input.slice(i + 1, close);
          const href = input.slice(close + 2, end);
          spans.push({ kind: "link", text: label, href });
          i = end + 1;
          continue;
        }
      }
    }

    // `code`
    if (input[i] === "`") {
      const end = input.indexOf("`", i + 1);
      if (end > i) {
        spans.push({ kind: "code", text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // **bold**
    if (input.startsWith("**", i)) {
      const end = input.indexOf("**", i + 2);
      if (end > i + 1) {
        spans.push({ kind: "bold", text: input.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // *italic* (single asterisk, not part of **)
    if (input[i] === "*" && input[i + 1] !== "*") {
      const end = input.indexOf("*", i + 1);
      if (end > i) {
        spans.push({ kind: "italic", text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    pushText(input[i]!);
    i += 1;
  }

  return spans;
}
