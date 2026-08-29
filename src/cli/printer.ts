import type { AgentEvent } from "../agent/events.js";

/** Simple stdout printer for agent events (keeps UI out of the loop). */
export function createPrinter(): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        console.log(`\n=== NanCodeAgent ===\nTask: ${event.task}\n`);
        break;
      case "turn_start":
        console.log(`--- turn ${event.turn} ---`);
        break;
      case "assistant_text":
        console.log(event.text);
        break;
      case "tool_start":
        console.log(`\n> tool ${event.name}(${summarize(event.args)})`);
        break;
      case "tool_end": {
        const preview =
          event.output.length > 500 ? `${event.output.slice(0, 500)}…` : event.output;
        console.log(preview);
        break;
      }
      case "permission":
        if (event.decision !== "allow") {
          console.log(`[permission ${event.decision}] ${event.name}: ${event.reason ?? ""}`);
        }
        break;
      case "agent_end":
        console.log(`\n=== done (${event.reason}) ===\n`);
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
