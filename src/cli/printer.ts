import type { AgentEvent } from "../agent/events.js";

export interface PrinterOptions {
  /** Quieter banners for multi-turn REPL. */
  compact?: boolean;
}

/** Simple stdout printer for agent events (UI separate from the loop). */
export function createPrinter(
  options: PrinterOptions = {},
): (event: AgentEvent) => void {
  const compact = options.compact ?? false;

  return (event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        if (compact) {
          if (event.task) console.log(`\n→ ${event.task}`);
        } else {
          console.log(
            event.task
              ? `\n=== NanCodeAgent ===\nTask: ${event.task}\n`
              : `\n=== NanCodeAgent (continue) ===\n`,
          );
        }
        break;
      case "turn_start":
        if (!compact) console.log(`--- turn ${event.turn} ---`);
        break;
      case "assistant_message":
        if (event.content) console.log(event.content);
        if (event.toolCallCount > 0) {
          console.log(`(requesting ${event.toolCallCount} tool call(s))`);
        }
        break;
      case "tool_execution_start":
        console.log(`\n> ${event.toolName}(${summarize(event.args)})`);
        break;
      case "tool_execution_end": {
        const preview =
          event.output.length > 500
            ? `${event.output.slice(0, 500)}…`
            : event.output;
        console.log(event.isError ? `[error] ${preview}` : preview);
        break;
      }
      case "permission":
        if (event.decision !== "allow") {
          console.log(
            `[permission ${event.decision}] ${event.toolName}: ${event.reason ?? ""}`,
          );
        }
        break;
      case "turn_end":
        break;
      case "agent_end":
        if (compact) {
          console.log(`(done: ${event.reason}, ${event.turns} turns)\n`);
        } else {
          console.log(
            `\n=== done (${event.reason}, ${event.turns} turns) ===\n`,
          );
        }
        break;
      case "error":
        console.error(`[error] ${event.message}`);
        break;
      default:
        break;
    }
  };
}

function summarize(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}
