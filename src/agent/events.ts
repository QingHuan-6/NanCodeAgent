export type AgentEvent =
  | { type: "agent_start"; task: string }
  | { type: "turn_start"; turn: number }
  | { type: "assistant_text"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; output: string }
  | { type: "permission"; name: string; decision: string; reason?: string }
  | { type: "agent_end"; reason: string }
  | { type: "error"; message: string };

export type AgentEventHandler = (event: AgentEvent) => void;

export function noopEvents(): AgentEventHandler {
  return () => undefined;
}
