import type { ReactNode } from "react";
import type { ToolUiDiff } from "../../agent/events.js";
import { theme } from "./theme.js";

export function DiffBlock({ diff }: { diff: ToolUiDiff }): ReactNode {
  return (
    <box flexDirection="column" marginLeft={2}>
      {diff.lines.map((line, i) => {
        const key = `${diff.path}-${i}`;
        switch (line.kind) {
          case "add":
            return (
              <text key={key} fg={theme.add}>
                {`+ ${line.text}`}
              </text>
            );
          case "remove":
            return (
              <text key={key} fg={theme.remove}>
                {`- ${line.text}`}
              </text>
            );
          case "header":
            return (
              <text key={key} fg={theme.header}>
                {line.text}
              </text>
            );
          default:
            return (
              <text key={key} fg={theme.dim}>
                {`  ${line.text}`}
              </text>
            );
        }
      })}
    </box>
  );
}
