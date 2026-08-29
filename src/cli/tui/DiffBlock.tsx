import React from "react";
import { Box, Text } from "ink";
import type { ToolUiDiff } from "../../agent/events.js";
import { theme } from "./theme.js";

export function DiffBlock({ diff }: { diff: ToolUiDiff }): React.ReactElement {
  return (
    <Box flexDirection="column" marginLeft={2} marginY={0}>
      {diff.lines.map((line, i) => {
        const key = `${diff.path}-${i}`;
        switch (line.kind) {
          case "add":
            return (
              <Text key={key} color={theme.add}>
                + {line.text}
              </Text>
            );
          case "remove":
            return (
              <Text key={key} color={theme.remove}>
                - {line.text}
              </Text>
            );
          case "header":
            return (
              <Text key={key} color={theme.header} dimColor>
                {line.text}
              </Text>
            );
          default:
            return (
              <Text key={key} dimColor>
                {"  "}
                {line.text}
              </Text>
            );
        }
      })}
    </Box>
  );
}
