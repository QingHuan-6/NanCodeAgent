import type { ReactNode } from "react";
import { parseMarkdown, type InlineSpan, type MdBlock } from "./markdown.js";
import { theme } from "./theme.js";

/**
 * Lightweight markdown → OpenTUI nodes (no tree-sitter dependency).
 */
export function MarkdownView({
  source,
  color = theme.assistant,
}: {
  source: string;
  color?: string;
}): ReactNode {
  const blocks = parseMarkdown(source);
  return (
    <box flexDirection="column">
      {blocks.map((block, idx) => (
        <BlockView key={idx} block={block} color={color} />
      ))}
    </box>
  );
}

function BlockView({
  block,
  color,
}: {
  block: MdBlock;
  color: string;
}): ReactNode {
  switch (block.kind) {
    case "blank":
      return <text> </text>;
    case "heading":
      return (
        <text>
          <strong fg={theme.header}>{renderSpans(block.spans, color)}</strong>
        </text>
      );
    case "list_item": {
      const bullet = block.ordered ? `${block.index ?? 1}. ` : "• ";
      return (
        <text fg={color}>
          {bullet}
          {renderSpans(block.spans, color)}
        </text>
      );
    }
    case "code":
      return (
        <box flexDirection="column" marginLeft={1}>
          {block.lang ? (
            <text fg={theme.dim}>{`\`\`\`${block.lang}`}</text>
          ) : null}
          {block.text.split("\n").map((line, i) => (
            <text key={i} fg={theme.tool}>
              {line || " "}
            </text>
          ))}
          {block.lang ? <text fg={theme.dim}>{"```"}</text> : null}
        </box>
      );
    case "paragraph":
      return <text fg={color}>{renderSpans(block.spans, color)}</text>;
    default:
      return null;
  }
}

function renderSpans(spans: InlineSpan[], color: string): ReactNode {
  return spans.map((span, i) => {
    switch (span.kind) {
      case "text":
        return (
          <span key={i} fg={color}>
            {span.text}
          </span>
        );
      case "code":
        return (
          <span key={i} fg={theme.tool}>
            {span.text}
          </span>
        );
      case "bold":
        return (
          <strong key={i} fg={color}>
            {span.text}
          </strong>
        );
      case "italic":
        return (
          <em key={i} fg={color}>
            {span.text}
          </em>
        );
      case "link": {
        const same =
          span.text === span.href || /^https?:\/\//i.test(span.text);
        return same ? (
          <span key={i} fg={theme.user}>
            {span.href}
          </span>
        ) : (
          <span key={i} fg={theme.user}>
            {span.text}
            <span fg={theme.dim}>{` (${span.href})`}</span>
          </span>
        );
      }
      default:
        return null;
    }
  });
}
