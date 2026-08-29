import pc from "picocolors";
import type { AgentEvent, ToolUiDiffLine } from "../agent/events.js";

export interface PrinterOptions {
  /** Quieter banners for multi-turn REPL. */
  compact?: boolean;
  /** Colorize stdout (default: TTY). */
  color?: boolean;
}

/** Stdout printer for agent events (plain / one-shot mode). */
export function createPrinter(
  options: PrinterOptions = {},
): (event: AgentEvent) => void {
  const compact = options.compact ?? false;
  const color =
    options.color ??
    (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);

  let streaming = false;

  return (event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        if (compact) {
          if (event.task) console.log(`\n${c(color, "cyan", "→")} ${event.task}`);
        } else {
          console.log(
            event.task
              ? `\n${c(color, "bold", "=== NanCodeAgent ===")}\nTask: ${event.task}\n`
              : `\n${c(color, "bold", "=== NanCodeAgent (continue) ===")}\n`,
          );
        }
        break;
      case "turn_start":
        if (!compact) console.log(c(color, "dim", `--- turn ${event.turn} ---`));
        break;
      case "message_start":
        streaming = true;
        break;
      case "message_delta":
        process.stdout.write(event.text);
        break;
      case "assistant_message":
        if (streaming) {
          process.stdout.write("\n");
          streaming = false;
        } else if (event.content) {
          console.log(event.content);
        }
        if (event.toolCallCount > 0) {
          console.log(
            c(color, "dim", `(requesting ${event.toolCallCount} tool call(s))`),
          );
        }
        break;
      case "tool_execution_start":
        console.log(
          `\n${c(color, "yellow", ">")} ${event.toolName}(${summarize(event.args)})`,
        );
        break;
      case "tool_execution_end": {
        if (event.ui?.diff?.lines?.length) {
          printDiff(event.ui.diff.lines, color);
        } else {
          const preview =
            event.output.length > 500
              ? `${event.output.slice(0, 500)}…`
              : event.output;
          console.log(
            event.isError
              ? c(color, "red", `[error] ${preview}`)
              : c(color, "dim", preview),
          );
        }
        break;
      }
      case "permission":
        if (event.decision !== "allow") {
          console.log(
            c(
              color,
              "magenta",
              `[permission ${event.decision}] ${event.toolName}: ${event.reason ?? ""}`,
            ),
          );
        }
        break;
      case "turn_end":
        break;
      case "agent_end":
        if (compact) {
          console.log(
            c(color, "dim", `(done: ${event.reason}, ${event.turns} turns)\n`),
          );
        } else {
          console.log(
            `\n${c(color, "bold", `=== done (${event.reason}, ${event.turns} turns) ===`)}\n`,
          );
        }
        break;
      case "error":
        console.error(c(color, "red", `[error] ${event.message}`));
        break;
      default:
        break;
    }
  };
}

function printDiff(lines: ToolUiDiffLine[], color: boolean): void {
  for (const line of lines) {
    switch (line.kind) {
      case "add":
        console.log(c(color, "green", `+ ${line.text}`));
        break;
      case "remove":
        console.log(c(color, "red", `- ${line.text}`));
        break;
      case "header":
        console.log(c(color, "cyan", line.text));
        break;
      default:
        console.log(c(color, "dim", `  ${line.text}`));
        break;
    }
  }
}

function summarize(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}

function c(
  enabled: boolean,
  style: "cyan" | "dim" | "bold" | "yellow" | "red" | "green" | "magenta",
  text: string,
): string {
  if (!enabled) return text;
  return pc[style](text);
}
