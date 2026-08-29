import type { AgentEvent } from "../agent/events.js";

/** Simple stdout printer for agent events (UI separate from the loop). */
export function createPrinter(): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        console.log(
          event.task
            ? `\n=== NanCodeAgent ===\nTask: ${event.task}\n`
            : `\n=== NanCodeAgent (continue) ===\n`,
        );
        break;
      case "turn_start":
        console.log(`--- turn ${event.turn} ---`);
        break;
      case "assistant_message":
        if (event.content) console.log(event.content);
        if (event.toolCallCount > 0) {
          console.log(`(requesting ${event.toolCallCount} tool call(s))`);
        }
        break;
      case "tool_execution_start":
        console.log(
          `\n> ${event.toolName}(${summarize(event.args)})`,
        );
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
        console.log(`\n=== done (${event.reason}, ${event.turns} turns) ===\n`);
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
