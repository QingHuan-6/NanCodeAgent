/**
 * Stateful wrapper around the agent loop.
 * Owns steering / follow-up queues, abort, mode, and default context prune.
 */

import type { Config } from "../config/index.js";
import type { ChatMessage } from "../llm/types.js";
import type { LlmClient } from "../llm/client.js";
import type { Session } from "../session/session.js";
import {
  createRegistryForMode,
  type AgentToolMode,
  type ToolRegistry,
} from "../tools/index.js";
import type { AgentEventHandler } from "./events.js";
import {
  compactMessagesInPlace,
  createDefaultTransformContext,
} from "./context.js";
import { continueAgentLoop, runAgentLoop } from "./loop.js";
import { buildSystemPrompt } from "./prompt.js";
import { PendingMessageQueue, type QueueMode } from "./queue.js";
import type {
  AgentLoopOptions,
  AgentLoopResult,
  ToolExecutionMode,
} from "./types.js";

export interface AgentRuntimeOptions {
  config: Config;
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
  onEvent?: AgentEventHandler;
  askPermission?: AgentLoopOptions["askPermission"];
  toolExecution?: ToolExecutionMode;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  mode?: AgentToolMode;
  /** Context prune char budget (default 120_000). */
  contextMaxChars?: number;
}

export class AgentRuntime {
  config: Config;
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
  onEvent?: AgentEventHandler;
  askPermission?: AgentLoopOptions["askPermission"];
  toolExecution: ToolExecutionMode;
  mode: AgentToolMode;

  private readonly steeringQueue: PendingMessageQueue<ChatMessage>;
  private readonly followUpQueue: PendingMessageQueue<ChatMessage>;
  private activeAbort?: AbortController;
  private running = false;
  private skipInitialSteeringPoll = false;
  private readonly contextMaxChars: number;

  constructor(options: AgentRuntimeOptions) {
    this.config = options.config;
    this.llm = options.llm;
    this.tools = options.tools;
    this.session = options.session;
    this.onEvent = options.onEvent;
    this.askPermission = options.askPermission;
    this.toolExecution = options.toolExecution ?? "parallel";
    this.mode = options.mode ?? "agent";
    this.steeringQueue = new PendingMessageQueue(
      options.steeringMode ?? "one-at-a-time",
    );
    this.followUpQueue = new PendingMessageQueue(
      options.followUpMode ?? "one-at-a-time",
    );
    this.contextMaxChars = options.contextMaxChars ?? 120_000;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get signal(): AbortSignal | undefined {
    return this.activeAbort?.signal;
  }

  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }

  /** Switch agent ↔ plan (read-only). Refreshes tools + system prompt. */
  setMode(mode: AgentToolMode): void {
    if (this.running) {
      throw new Error("Cannot change mode while the agent is running.");
    }
    this.mode = mode;
    this.tools = createRegistryForMode(mode);
    this.refreshSystemPrompt();
  }

  steer(text: string): void {
    const content = text.trim();
    if (!content) return;
    this.steeringQueue.enqueue({ role: "user", content });
  }

  followUp(text: string): void {
    const content = text.trim();
    if (!content) return;
    this.followUpQueue.enqueue({ role: "user", content });
  }

  clearQueues(): void {
    this.steeringQueue.clear();
    this.followUpQueue.clear();
  }

  hasQueuedMessages(): boolean {
    return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
  }

  abort(): void {
    this.activeAbort?.abort();
  }

  async prompt(task: string): Promise<AgentLoopResult> {
    if (this.running) {
      throw new Error(
        "Agent is already processing. Use steer() or followUp(), or wait for completion.",
      );
    }
    return this.runWithLifecycle((signal) =>
      runAgentLoop(task, this.buildLoopOptions(signal)),
    );
  }

  async continue(): Promise<AgentLoopResult> {
    if (this.running) {
      throw new Error(
        "Agent is already processing. Use steer() or followUp(), or wait for completion.",
      );
    }

    const messages = this.session.getMessages();
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && this.hasQueuedMessages()) {
      const steered =
        this.steeringQueue.drain()[0] ?? this.followUpQueue.drain()[0];
      if (steered && typeof steered.content === "string") {
        return this.prompt(steered.content);
      }
    }

    this.skipInitialSteeringPoll = true;
    try {
      return await this.runWithLifecycle((signal) =>
        continueAgentLoop(this.buildLoopOptions(signal)),
      );
    } finally {
      this.skipInitialSteeringPoll = false;
    }
  }

  compact(maxChars = 40_000): { removed: number } {
    const { messages, removed } = compactMessagesInPlace(
      this.session.getMessages(),
      { maxChars, preserveRecentBlocks: 6 },
    );
    this.session.replaceMessages(messages);
    return { removed };
  }

  private refreshSystemPrompt(): void {
    const system: ChatMessage = {
      role: "system",
      content: buildSystemPrompt({
        workspace: this.config.workspace,
        mode: this.mode,
      }),
    };
    const rest = this.session.getMessages().filter((m) => m.role !== "system");
    this.session.replaceMessages([system, ...rest]);
  }

  private async runWithLifecycle(
    executor: (signal: AbortSignal) => Promise<AgentLoopResult>,
  ): Promise<AgentLoopResult> {
    this.running = true;
    const ac = new AbortController();
    this.activeAbort = ac;
    try {
      return await executor(ac.signal);
    } finally {
      this.running = false;
      this.activeAbort = undefined;
    }
  }

  private buildLoopOptions(signal: AbortSignal): AgentLoopOptions {
    let skipInitial = this.skipInitialSteeringPoll;
    return {
      llm: this.llm,
      tools: this.tools,
      session: this.session,
      workspace: this.config.workspace,
      maxTurns: this.config.maxTurns,
      stream: true,
      toolExecution: this.toolExecution,
      mode: this.mode,
      onEvent: this.onEvent,
      askPermission: this.askPermission,
      signal,
      transformContext: createDefaultTransformContext({
        maxChars: this.contextMaxChars,
      }),
      getSteeringMessages: async () => {
        if (skipInitial) {
          skipInitial = false;
          return [];
        }
        return this.steeringQueue.drain();
      },
      getFollowUpMessages: async () => this.followUpQueue.drain(),
    };
  }
}
