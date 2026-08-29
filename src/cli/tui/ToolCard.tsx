import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { DiffBlock } from "./DiffBlock.js";
import { theme } from "./theme.js";
import {
  toolDoneLabel,
  toolRunningLabel,
  type TimelineItem,
} from "./types.js";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

/**
 * Activity-log tool row:
 *   • Searching for "def " in *.py
 *   • Searched for "def " in *.py · 15 matches  ▶
 * Full output only when expanded (Ctrl+O).
 */
export function ToolCard({
  card,
  focused,
}: {
  card: ToolItem;
  focused: boolean;
}): React.ReactElement {
  const bullet = focused ? "●" : "•";

  if (card.status === "running") {
    return (
      <Box marginLeft={1}>
        <Text color={theme.tool}>
          {bullet} <Spinner type="dots" />{" "}
          {toolRunningLabel(card.toolName, card.subject)}
        </Text>
      </Box>
    );
  }

  const ok = card.status === "done";
  const hasBody = Boolean(card.diff || (card.output && card.output.length > 0));
  const label = toolDoneLabel(
    card.toolName,
    card.subject,
    card.output,
    !ok,
  );

  return (
    <Box flexDirection="column" marginLeft={1}>
      <Text color={ok ? theme.dim : theme.error}>
        {bullet} {label}
        {hasBody ? (card.expanded ? "  ▼" : "  ▶") : ""}
      </Text>

      {card.expanded && card.diff ? <DiffBlock diff={card.diff} /> : null}
      {card.expanded && !card.diff && card.output ? (
        <Box flexDirection="column" marginLeft={3}>
          {truncateLines(card.output, 40).map((line, i) => (
            <Text
              key={`${card.id}-l-${i}`}
              dimColor={ok}
              color={ok ? undefined : theme.error}
            >
              {line || " "}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function truncateLines(text: string, maxLines: number): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return lines;
  return [
    ...lines.slice(0, maxLines),
    `… (${lines.length - maxLines} more lines)`,
  ];
}
