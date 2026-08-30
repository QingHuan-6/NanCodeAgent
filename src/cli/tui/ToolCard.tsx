import type { ReactNode } from "react";
import {
  toolDoneLabel,
  toolRunningLabel,
  type TimelineItem,
} from "./types.js";
import { theme } from "./theme.js";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

/** One-line activity row; output opens in ToolDetailPanel. */
export function ToolCard({
  card,
  focused,
  detailOpen,
}: {
  card: ToolItem;
  focused: boolean;
  detailOpen?: boolean;
}): ReactNode {
  const bullet = focused ? "●" : "•";

  if (card.status === "running") {
    return (
      <box marginLeft={1}>
        <text fg={theme.tool}>
          {`${bullet} … ${toolRunningLabel(card.toolName, card.subject)}`}
        </text>
      </box>
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
    <box marginLeft={1}>
      <text fg={ok ? theme.dim : theme.error}>
        {`${bullet} ${label}${hasBody ? (focused && detailOpen ? "  ▼" : "  ▶") : ""}`}
      </text>
    </box>
  );
}
