import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { DiffBlock } from "./DiffBlock.js";
import { theme } from "./theme.js";
import {
  countOutputLines,
  summarizeOutput,
  type TimelineItem,
} from "./types.js";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

export function ToolCard({
  card,
  focused,
}: {
  card: ToolItem;
  focused: boolean;
}): React.ReactElement {
  if (card.status === "running") {
    return (
      <Box flexDirection="column" marginLeft={1} marginBottom={0}>
        <Box>
          <Text color={theme.tool}>
            {focused ? "● " : "  "}
            <Spinner type="dots" /> {card.toolName}
          </Text>
          <Text dimColor> {card.argsSummary}</Text>
        </Box>
      </Box>
    );
  }

  const ok = card.status === "done";
  const hasBody = Boolean(card.diff || (card.output && card.output.length > 0));
  const lines = card.output ? countOutputLines(card.output) : card.diff ? card.diff.lines.length : 0;
  const foldHint = hasBody ? (card.expanded ? " ▼" : " ▶") : "";

  return (
    <Box flexDirection="column" marginLeft={1} marginBottom={0}>
      <Box>
        <Text color={ok ? theme.success : theme.error}>
          {focused ? "● " : "  "}
          {ok ? "✓" : "✗"} {card.toolName}
        </Text>
        <Text dimColor>
          {" "}
          {card.argsSummary}
          {hasBody ? ` · ${lines}L${foldHint}` : ""}
        </Text>
      </Box>

      {card.expanded && card.diff ? <DiffBlock diff={card.diff} /> : null}
      {card.expanded && !card.diff && card.output ? (
        <Box flexDirection="column" marginLeft={4}>
          {truncateLines(card.output, 60).map((line, i) => (
            <Text
              key={`${card.id}-l-${i}`}
              color={ok ? undefined : theme.error}
              dimColor={ok}
            >
              {line || " "}
            </Text>
          ))}
        </Box>
      ) : null}

      {!card.expanded && hasBody && card.output && !card.diff ? (
        <Text dimColor>
          {"    "}
          {summarizeOutput(card.output)}
        </Text>
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
