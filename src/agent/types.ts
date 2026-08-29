/**
 * Agent module shared types.
 */

import type { LlmClient } from "../llm/client.js";
import type {
  ChatMessage,
  ChatRequestOptions,
  ChatResult,
  OpenAIToolDefinition,
  StreamEvent,
} from "../llm/types.js";
import type { Session } from "../session/session.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolResult } from "../tools/types.js";
import type { AgentEventHandler } from "./events.js";

/** Minimal LLM surface required by the agent loop. */
export interface LlmChatPort {
  chat(
    messages: ChatMessage[],
    tools?: OpenAIToolDefinition[],
    options?: Pick<ChatRequestOptions, "signal" | "maxTokens" | "temperature">,
  ): Promise<ChatMessage>;
  /**
   * Optional streaming. When present (and stream !== false), the loop prefers this
   * and emits message_start / message_delta events.
   */
  streamChat?(
    messages: ChatMessage[],
    options?: ChatRequestOptions,
  ): AsyncGenerator<StreamEvent, ChatResult, undefined>;
}

/** Why the agent loop stopped. */
export type StopReason =
  | "completed"
  | "max_turns"
  | "doom_loop"
  | "aborted"
  | "tool_terminate"
  | "error"
  | "should_stop";

/** Pi-style tool batch execution mode. */
export type ToolExecutionMode = "parallel" | "sequential";

export interface AgentLoopOptions {
  llm: LlmChatPort | LlmClient;
  tools: ToolRegistry;
  session: Session;
  workspace: string;
  maxTurns: number;
  /** How many identical tool+args in a row before stopping. */
  doomLoopThreshold?: number;
  /** Prefer streamChat when available (default true). */
  stream?: boolean;
  /** Default parallel. */
  toolExecution?: ToolExecutionMode;
  /** agent = full tools; plan = read-only. */
  mode?: "agent" | "plan";
  onEvent?: AgentEventHandler;
  signal?: AbortSignal;
  beforeToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<BeforeToolCallResult> | BeforeToolCallResult;
  askPermission?: (reason: string, toolName: string) => Promise<boolean>;
  /** Interactive ask_user tool handler. */
  askUser?: (req: {
    question: string;
    options?: string[];
  }) => Promise<string>;
  shouldStopAfterTurn?: (ctx: AfterTurnContext) => Promise<boolean> | boolean;
  /** Called once per LLM call; must not throw. Does not mutate session by itself. */
  transformContext?: (
    messages: ChatMessage[],
    signal?: AbortSignal,
  ) => Promise<ChatMessage[]> | ChatMessage[];
  /**
   * Drain steering queue (Pi). Called after tools / at loop start.
   * Injected as user messages before the next LLM call.
   */
  getSteeringMessages?: () => Promise<ChatMessage[]> | ChatMessage[];
  /**
   * Drain follow-up queue when the agent would otherwise stop (no more tools).
   */
  getFollowUpMessages?: () => Promise<ChatMessage[]> | ChatMessage[];
  /**
   * Called once when the LLM reports context_length / prompt too long.
   * Should compact the session in place and return true to retry the call.
   */
  onContextOverflow?: () => Promise<boolean> | boolean;
}

export interface BeforeToolCallResult {
  decision: "allow" | "deny" | "ask";
  reason?: string;
  /** If set on every tool in a batch, skip the next LLM follow-up. */
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
  signature: string;
  parseError?: string;
}
