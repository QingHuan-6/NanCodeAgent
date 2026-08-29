/**
 * Agent events for UI / logging.
 * Aligned with Pi's event vocabulary; streaming deltas deferred.
 */

export type AgentEvent =
  | { type: "agent_start"; task?: string }
  | { type: "agent_end"; reason: string; turns: number }
  | { type: "turn_start"; turn: number }
  | {
      type: "turn_end";
      turn: number;
      hasToolCalls: boolean;
      toolCount: number;
    }
  | { type: "assistant_message"; content: string | null; toolCallCount: number }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      output: string;
      isError: boolean;
    }
  | {
      type: "permission";
      toolName: string;
      decision: "allow" | "deny" | "ask";
      reason?: string;
    }
  | { type: "error"; message: string };

export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;

export function noopEvents(): AgentEventHandler {
  return () => undefined;
}

/** Fire-and-forget safe emit (await async handlers in registration order). */
export async function emitEvent(
  handler: AgentEventHandler,
  event: AgentEvent,
): Promise<void> {
  await handler(event);
}
