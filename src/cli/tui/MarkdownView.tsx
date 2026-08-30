import React from "react";
import { Box, Text } from "ink";
import { parseMarkdown, type InlineSpan, type MdBlock } from "./markdown.js";
import { theme } from "./theme.js";

/**
 * Render a markdown subset as Ink nodes (markers concealed).
 */
export function MarkdownView({
  source,
  color = theme.assistant,
}: {
  source: string;
  color?: string;
}): React.ReactElement {
  const blocks = parseMarkdown(source);
  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => (
        <BlockView key={idx} block={block} color={color} />
      ))}
    </Box>
  );
}

function BlockView({
  block,
  color,
}: {
  block: MdBlock;
  color: string;
}): React.ReactElement | null {
  switch (block.kind) {
    case "blank":
      return <Text> </Text>;
    case "heading":
      return (
        <Text bold color={theme.header}>
          {renderSpans(block.spans, color)}
        </Text>
      );
    case "list_item": {
      const bullet = block.ordered
        ? `${block.index ?? 1}. `
        : "• ";
      return (
        <Text color={color}>
          {bullet}
          {renderSpans(block.spans, color)}
        </Text>
      );
    }
    case "code":
      return (
        <Box flexDirection="column" marginLeft={1}>
          {block.lang ? (
            <Text dimColor>
              {"```"}
              {block.lang}
            </Text>
          ) : null}
          {block.text.split("\n").map((line, i) => (
            <Text key={i} color={theme.tool}>
              {line || " "}
            </Text>
          ))}
          {block.lang ? <Text dimColor>{"```"}</Text> : null}
        </Box>
      );
    case "paragraph":
      return <Text color={color}>{renderSpans(block.spans, color)}</Text>;
    default:
      return null;
  }
}

function renderSpans(
  spans: InlineSpan[],
  color: string,
): React.ReactNode {
  return spans.map((span, i) => {
    switch (span.kind) {
      case "text":
        return (
          <Text key={i} color={color}>
            {span.text}
          </Text>
        );
      case "code":
        return (
          <Text key={i} color={theme.tool}>
            {span.text}
          </Text>
        );
      case "bold":
        return (
          <Text key={i} bold color={color}>
            {span.text}
          </Text>
        );
      case "italic":
        return (
          <Text key={i} italic color={color}>
            {span.text}
          </Text>
        );
      case "link": {
        const same =
          span.text === span.href ||
          /^https?:\/\//i.test(span.text);
        return same ? (
          <Text key={i} color={theme.user}>
            {span.href}
          </Text>
        ) : (
          <Text key={i} color={theme.user}>
            {span.text}
            <Text dimColor> ({span.href})</Text>
          </Text>
        );
      }
      default:
        return null;
    }
  });
}
