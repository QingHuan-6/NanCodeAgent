import type { ChatMessage } from "../llm/types.js";
import { DoomLoopGuard } from "./doom-loop.js";
import { emitEvent, noopEvents } from "./events.js";
import { buildSystemPrompt } from "./prompt.js";
import {
  defaultBeforeToolCall,
  parseToolCall,
  runToolBatch,
  toolItemsToMessages,
} from "./tool-runner.js";
import type {
  AgentLoopOptions,
  AgentLoopResult,
  StopReason,
} from "./types.js";

/**
 * Core harness loop — messages → LLM → tools → repeat.
 *
 * Inspired by:
 * - Pi `runLoop` (turn boundaries, terminate-all, shouldStopAfterTurn, AbortSignal)
 * - claw-code `ConversationRuntime::run_turn` (max iterations, tool error feedback)
 * - OpenCode session loop (max steps / doom-loop guard)
 */
export async function runAgentLoop(
  task: string,
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  ensureSystemMessage(options);
  options.session.append({ role: "user", content: task });

  const onEvent = options.onEvent ?? noopEvents();
  await emitEvent(onEvent, { type: "agent_start", task });

  return runTurns(options, onEvent);
}

/**
 * Continue from existing session without a new user message
 * (Pi `agentLoopContinue`). Last message must be user or tool.
 */
export async function continueAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const messages = options.session.getMessages();
  if (messages.length === 0) {
    return failResult("Cannot continue: empty session", "error");
  }
  const last = messages[messages.length - 1];
  if (last.role === "assistant") {
    return failResult(
      "Cannot continue from an assistant message; add a user message or tool results first",
      "error",
    );
  }

  ensureSystemMessage(options);
  const onEvent = options.onEvent ?? noopEvents();
  await emitEvent(onEvent, { type: "agent_start" });
  return runTurns(options, onEvent);
}

async function runTurns(
  options: AgentLoopOptions,
  onEvent: NonNullable<AgentLoopOptions["onEvent"]>,
): Promise<AgentLoopResult> {
  const ask =
    options.askPermission ??
    (async () => false);
  const beforeToolCall =
    options.beforeToolCall ?? defaultBeforeToolCall(options.workspace);
  const doom = new DoomLoopGuard(options.doomLoopThreshold ?? 3);

  let lastText = "";
  let turns = 0;

  try {
    for (let turn = 1; turn <= options.maxTurns; turn++) {
      throwIfAborted(options.signal);
      turns = turn;
      await emitEvent(onEvent, { type: "turn_start", turn });

      const contextMessages = options.transformContext
        ? await options.transformContext(options.session.getMessages())
        : options.session.getMessages();

      const assistant = await options.llm.chat(
        contextMessages,
        options.tools.toOpenAITools(),
        { signal: options.signal },
      );
      options.session.append(assistant);

      if (assistant.content) {
        lastText = assistant.content;
      }

      const toolCalls = assistant.tool_calls ?? [];
      await emitEvent(onEvent, {
        type: "assistant_message",
        content: assistant.content,
        toolCallCount: toolCalls.length,
      });

      if (toolCalls.length === 0) {
        await emitEvent(onEvent, {
          type: "turn_end",
          turn,
          hasToolCalls: false,
          toolCount: 0,
        });
        return finish(onEvent, {
          finalText: lastText,
          turns,
          stopReason: "completed",
        });
      }

      // Doom-loop: observe each call signature before executing
      for (const raw of toolCalls) {
        const parsed = parseToolCall(raw);
        if (doom.observe(parsed)) {
          const msg =
            "Stopped: the same tool was called with the same arguments repeatedly (doom loop).";
          await emitEvent(onEvent, { type: "error", message: msg });
          return finish(onEvent, {
            finalText: msg,
            turns,
            stopReason: "doom_loop",
          });
        }
      }

      const { items, terminateBatch } = await runToolBatch(toolCalls, {
        tools: options.tools,
        workspace: options.workspace,
        onEvent,
        beforeToolCall,
        askPermission: ask,
        signal: options.signal,
      });

      for (const message of toolItemsToMessages(items)) {
        options.session.append(message);
      }

      await emitEvent(onEvent, {
        type: "turn_end",
        turn,
        hasToolCalls: true,
        toolCount: items.length,
      });

      if (terminateBatch) {
        return finish(onEvent, {
          finalText: lastText || items[items.length - 1]?.result.output || "",
          turns,
          stopReason: "tool_terminate",
        });
      }

      if (
        options.shouldStopAfterTurn &&
        (await options.shouldStopAfterTurn({
          turn,
          assistant,
          toolResults: items.map((i) => i.result),
          messages: options.session.getMessages(),
        }))
      ) {
        return finish(onEvent, {
          finalText: lastText,
          turns,
          stopReason: "should_stop",
        });
      }
    }

    return finish(onEvent, {
      finalText: lastText || "Stopped: max turns reached.",
      turns: options.maxTurns,
      stopReason: "max_turns",
    });
  } catch (err) {
    if (isAbortError(err) || options.signal?.aborted) {
      return finish(onEvent, {
        finalText: lastText,
        turns,
        stopReason: "aborted",
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    await emitEvent(onEvent, { type: "error", message });
    return finish(onEvent, {
      finalText: lastText,
      turns,
      stopReason: "error",
      error: message,
    });
  }
}

function ensureSystemMessage(options: AgentLoopOptions): void {
  const messages = options.session.getMessages();
  const hasSystem = messages.some((m) => m.role === "system");
  if (!hasSystem) {
    options.session.append({
      role: "system",
      content: buildSystemPrompt({ workspace: options.workspace }),
    });
  }
}

async function finish(
  onEvent: NonNullable<AgentLoopOptions["onEvent"]>,
  result: AgentLoopResult,
): Promise<AgentLoopResult> {
  await emitEvent(onEvent, {
    type: "agent_end",
    reason: result.stopReason,
    turns: result.turns,
  });
  return result;
}

function failResult(message: string, stopReason: StopReason): AgentLoopResult {
  return { finalText: message, turns: 0, stopReason, error: message };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("Agent aborted");
    err.name = "AbortError";
    throw err;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** @deprecated Prefer importing from ./types.js — re-exported for convenience. */
export type { AgentLoopOptions, AgentLoopResult, StopReason } from "./types.js";
