import type { ReactNode } from "react";
import { DiffBlock } from "./DiffBlock.js";
import { theme } from "./theme.js";
import { toolDoneLabel, type TimelineItem } from "./types.js";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

const DETAIL_MAX_LINES = 14;

/** Fixed chrome panel for tool output (does not expand inside ScrollBox). */
export function ToolDetailPanel({
  tool,
  index,
  total,
}: {
  tool: ToolItem;
  index: number;
  total: number;
}): ReactNode {
  const ok = tool.status !== "error";
  const label = toolDoneLabel(
    tool.toolName,
    tool.subject,
    tool.output,
    !ok,
  );

  return (
    <box
      border
      borderColor={theme.tool}
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
      flexDirection="column"
      backgroundColor={theme.panel}
    >
      <text fg={theme.tool}>
        {`Tool ${index + 1}/${total} · ${label} `}
        <span fg={theme.dim}>(ctrl+o close · ctrl+p/n)</span>
      </text>
      {tool.diff ? (
        <DiffBlock diff={tool.diff} />
      ) : tool.output ? (
        <box flexDirection="column">
          {truncateLines(tool.output, DETAIL_MAX_LINES).map((line, i) => (
            <text
              key={`detail-${tool.id}-${i}`}
              fg={ok ? theme.dim : theme.error}
            >
              {line || " "}
            </text>
          ))}
        </box>
      ) : (
        <text fg={theme.dim}>
          {tool.status === "running" ? "Still running…" : "(no output)"}
        </text>
      )}
    </box>
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
