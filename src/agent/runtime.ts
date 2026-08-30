/**
 * Stateful wrapper around the agent loop.
 * Owns steering / follow-up queues, abort, mode, and context compact/prune.
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
  compactMessages,
  type CompactOptions,
  type CompactResult,
} from "./compact.js";
import {
  createDefaultTransformContext,
  estimateMessagesChars,
} from "./context.js";
import { continueAgentLoop, runAgentLoop } from "./loop.js";
import { buildSystemPrompt } from "./prompt.js";
import { PendingMessageQueue, type QueueMode } from "./queue.js";
import type {
  AgentLoopOptions,
  AgentLoopResult,
  ToolExecutionMode,
} from "./types.js";
import { syncConfiguredSkillSources } from "../skills/discover.js";

export interface AgentRuntimeOptions {
  config: Config;
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
  onEvent?: AgentEventHandler;
  askPermission?: AgentLoopOptions["askPermission"];
  askUser?: AgentLoopOptions["askUser"];
  toolExecution?: ToolExecutionMode;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  mode?: AgentToolMode;
  /** Context prune char budget (default 120_000). */
  contextMaxChars?: number;
  /**
   * Auto LLM-compact when non-system chars exceed this fraction of contextMaxChars
   * (default 0.85). Set 0 to disable.
   */
  autoCompactRatio?: number;
}

export class AgentRuntime {
  config: Config;
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
  onEvent?: AgentEventHandler;
  askPermission?: AgentLoopOptions["askPermission"];
  askUser?: AgentLoopOptions["askUser"];
  toolExecution: ToolExecutionMode;
  mode: AgentToolMode;

  private readonly steeringQueue: PendingMessageQueue<ChatMessage>;
  private readonly followUpQueue: PendingMessageQueue<ChatMessage>;
  private activeAbort?: AbortController;
  private running = false;
  private skipInitialSteeringPoll = false;
  private readonly contextMaxChars: number;
  private readonly autoCompactRatio: number;
  /** One auto-compact per prompt/continue lifecycle. */
  private autoCompactUsed = false;
  private overflowCompactUsed = false;

  constructor(options: AgentRuntimeOptions) {
    this.config = options.config;
    this.llm = options.llm;
    this.tools = options.tools;
    this.session = options.session;
    this.onEvent = options.onEvent;
    this.askPermission = options.askPermission;
    this.askUser = options.askUser;
    this.toolExecution = options.toolExecution ?? "parallel";
    this.mode = options.mode ?? "agent";
    this.steeringQueue = new PendingMessageQueue(
      options.steeringMode ?? "one-at-a-time",
    );
    this.followUpQueue = new PendingMessageQueue(
      options.followUpMode ?? "one-at-a-time",
    );
    this.contextMaxChars = options.contextMaxChars ?? 120_000;
    this.autoCompactRatio = options.autoCompactRatio ?? 0.85;
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

  /**
   * Summarize older history with the LLM (fallback: prune).
   * Safe cut points — never splits tool_call pairs.
   */
  async compact(
    options: CompactOptions & { keepRecentChars?: number } = {},
  ): Promise<CompactResult> {
    const result = await compactMessages(
      this.session.getMessages(),
      this.llm,
      {
        keepRecentChars: options.keepRecentChars ?? 20_000,
        customInstructions: options.customInstructions,
        sessionId: this.session.id,
        signal: options.signal ?? this.activeAbort?.signal,
        pruneOnly: options.pruneOnly,
        pruneMaxChars: options.pruneMaxChars ?? 40_000,
      },
    );
    if (result.mode !== "noop") {
      this.session.replaceMessages(result.messages);
    }
    return result;
  }

  /** Rebuild system prompt (e.g. after /memory toggle). */
  refreshSystemPrompt(): void {
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
    this.autoCompactUsed = false;
    this.overflowCompactUsed = false;
    const ac = new AbortController();
    this.activeAbort = ac;
    try {
      // OpenCode-style: pull HTTP skill catalogs into cache before advertising.
      await syncConfiguredSkillSources(this.config.workspace);
      this.refreshSystemPrompt();
      return await executor(ac.signal);
    } finally {
      this.running = false;
      this.activeAbort = undefined;
    }
  }

  private buildLoopOptions(signal: AbortSignal): AgentLoopOptions {
    let skipInitial = this.skipInitialSteeringPoll;
    const prune = createDefaultTransformContext({
      maxChars: this.contextMaxChars,
      preserveRecentBlocks: 4,
      microcompact: {
        preserveRecentBlocks: 8,
        maxToolChars: 800,
        maxAssistantChars: 2_000,
      },
    });

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
      askUser: this.askUser,
      signal,
      transformContext: async (messages, sig) => {
        const rest = messages.filter((m) => m.role !== "system");
        const chars = estimateMessagesChars(rest);
        const threshold = Math.floor(
          this.contextMaxChars * this.autoCompactRatio,
        );
        if (
          this.autoCompactRatio > 0 &&
          !this.autoCompactUsed &&
          chars > threshold
        ) {
          this.autoCompactUsed = true;
          await this.compact({
            keepRecentChars: 20_000,
            signal: sig,
          });
          return prune(this.session.getMessages());
        }
        return prune(messages);
      },
      onContextOverflow: async () => {
        if (this.overflowCompactUsed) return false;
        this.overflowCompactUsed = true;
        const result = await this.compact({
          keepRecentChars: 12_000,
          signal,
        });
        return result.mode !== "noop";
      },
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
