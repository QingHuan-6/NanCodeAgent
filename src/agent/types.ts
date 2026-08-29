/**
 * Agent module shared types.
 * Shaped after Pi AgentLoopConfig + claw-code TurnSummary — kept minimal for MVP.
 */

import type { LlmClient } from "../llm/client.js";
import type { ChatMessage } from "../llm/types.js";
import type { Session } from "../session/session.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolResult } from "../tools/types.js";
import type { AgentEventHandler } from "./events.js";

/** Why the agent loop stopped. */
export type StopReason =
  | "completed"
  | "max_turns"
  | "doom_loop"
  | "aborted"
  | "tool_terminate"
  | "error"
  | "should_stop";

export interface AgentLoopOptions {
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
  workspace: string;
  maxTurns: number;
  /** How many identical tool+args in a row before stopping (OpenCode-style doom loop). */
  doomLoopThreshold?: number;
  onEvent?: AgentEventHandler;
  signal?: AbortSignal;
  /**
   * Permission / pre-tool gate (Pi `beforeToolCall`).
   * Default: use `checkPermission` from permissions.ts.
   */
  beforeToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<BeforeToolCallResult> | BeforeToolCallResult;
  /** When beforeToolCall returns ask — CLI confirms. Default: deny. */
  askPermission?: (reason: string, toolName: string) => Promise<boolean>;
  /**
   * Run after a completed turn (assistant + tools). Return true to exit
   * before the next LLM call (Pi `shouldStopAfterTurn`).
   */
  shouldStopAfterTurn?: (ctx: AfterTurnContext) => Promise<boolean> | boolean;
  /**
   * Optional context transform before each LLM call (Pi `transformContext`).
   * Default: identity.
   */
  transformContext?: (messages: ChatMessage[]) => Promise<ChatMessage[]> | ChatMessage[];
}

export interface BeforeToolCallResult {
  /** allow | deny | ask */
  decision: "allow" | "deny" | "ask";
  reason?: string;
  /** Participate in batch early-termination (Pi). */
  terminate?: boolean;
}

export interface AfterTurnContext {
  turn: number;
  assistant: ChatMessage;
  toolResults: ToolResult[];
  messages: ChatMessage[];
}

export interface AgentLoopResult {
  finalText: string;
  turns: number;
  stopReason: StopReason;
  error?: string;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Stable signature for doom-loop detection. */
  signature: string;
  parseError?: string;
}
