import type { ChatMessage, OpenAIToolDefinition } from "../llm/types.js";
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
  LlmChatPort,
  StopReason,
} from "./types.js";

type PendingUser = {
  message: ChatMessage;
  source: "steer" | "follow_up";
};

/**
 * Core harness loop — messages → LLM → tools → repeat.
 *
 * Pi-shaped: outer follow-up loop + inner tool/steering loop;
 * transformContext per LLM call; steering injected after tool batches.
 */
export async function runAgentLoop(
  task: string,
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  ensureSystemMessage(options);
  options.session.append({ role: "user", content: task });

  const onEvent = options.onEvent ?? noopEvents();
  await emitEvent(onEvent, { type: "agent_start", task });
  await emitEvent(onEvent, {
    type: "user_message",
    content: task,
    source: "prompt",
  });

  return runTurns(options, onEvent);
}

/**
 * Continue from existing session without a new user message.
 * Last message must be user or tool (Pi agentLoopContinue).
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
  const ask = options.askPermission ?? (async () => false);
  const beforeToolCall =
    options.beforeToolCall ?? defaultBeforeToolCall(options.workspace);
  const doom = new DoomLoopGuard(options.doomLoopThreshold ?? 3);

  let lastText = "";
  let turns = 0;

  try {
    // Steering typed while idle / between prompts (Pi initial poll).
    let pending: PendingUser[] = (
      await drainMessages(options.getSteeringMessages)
    ).map((message) => ({ message, source: "steer" as const }));

    while (true) {
      let hasMoreToolCalls = true;

      while (hasMoreToolCalls || pending.length > 0) {
        throwIfAborted(options.signal);

        if (turns >= options.maxTurns) {
          return finish(onEvent, {
            finalText: lastText || "Stopped: max turns reached.",
            turns,
            stopReason: "max_turns",
          });
        }
        turns += 1;
        await emitEvent(onEvent, { type: "turn_start", turn: turns });

        if (pending.length > 0) {
          for (const item of pending) {
            options.session.append(item.message);
            const content =
              typeof item.message.content === "string"
                ? item.message.content
                : "";
            await emitEvent(onEvent, {
              type: "user_message",
              content,
              source: item.source,
            });
          }
          pending = [];
        }

        const rawMessages = options.session.getMessages();
        const contextMessages = options.transformContext
          ? await options.transformContext(rawMessages, options.signal)
          : rawMessages;

        const assistant = await callLlm(
          options.llm,
          contextMessages,
          options.tools.toOpenAITools(),
          onEvent,
          options.signal,
          options.stream !== false,
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

        let toolCount = 0;
        hasMoreToolCalls = false;

        if (toolCalls.length > 0) {
          for (const raw of toolCalls) {
            const parsed = parseToolCall(raw);
            if (doom.observe(parsed)) {
              const msg =
                "Stopped: the same tool was called with the same arguments repeatedly (doom loop).";
              await emitEvent(onEvent, { type: "error", message: msg });
              await emitEvent(onEvent, {
                type: "turn_end",
                turn: turns,
                hasToolCalls: true,
                toolCount: 0,
              });
              return finish(onEvent, {
                finalText: msg,
                turns,
                stopReason: "doom_loop",
              });
            }
          }

          const batch = await runToolBatch(toolCalls, {
            tools: options.tools,
            workspace: options.workspace,
            sessionId: options.session.id,
            onEvent,
            beforeToolCall,
            askPermission: ask,
            signal: options.signal,
            toolExecution: options.toolExecution ?? "parallel",
          });

          for (const message of toolItemsToMessages(batch.items)) {
            options.session.append(message);
          }
          toolCount = batch.items.length;

          if (batch.terminateBatch) {
            await emitEvent(onEvent, {
              type: "turn_end",
              turn: turns,
              hasToolCalls: true,
              toolCount,
            });
            return finish(onEvent, {
              finalText:
                lastText ||
                batch.items[batch.items.length - 1]?.result.output ||
                "",
              turns,
              stopReason: "tool_terminate",
            });
          }

          hasMoreToolCalls = true;

          await emitEvent(onEvent, {
            type: "turn_end",
            turn: turns,
            hasToolCalls: true,
            toolCount,
          });

          if (
            options.shouldStopAfterTurn &&
            (await options.shouldStopAfterTurn({
              turn: turns,
              assistant,
              toolResults: batch.items.map((i) => i.result),
              messages: options.session.getMessages(),
            }))
          ) {
            return finish(onEvent, {
              finalText: lastText,
              turns,
              stopReason: "should_stop",
            });
          }

          pending = (
            await drainMessages(options.getSteeringMessages)
          ).map((message) => ({ message, source: "steer" as const }));
          continue;
        }

        // Text-only turn — agent may stop unless steering / follow-up arrives.
        await emitEvent(onEvent, {
          type: "turn_end",
          turn: turns,
          hasToolCalls: false,
          toolCount: 0,
        });

        if (
          options.shouldStopAfterTurn &&
          (await options.shouldStopAfterTurn({
            turn: turns,
            assistant,
            toolResults: [],
            messages: options.session.getMessages(),
          }))
        ) {
          return finish(onEvent, {
            finalText: lastText,
            turns,
            stopReason: "should_stop",
          });
        }

        pending = (
          await drainMessages(options.getSteeringMessages)
        ).map((message) => ({ message, source: "steer" as const }));
      }

      // Agent would stop. Drain follow-ups (Pi outer loop).
      const followUps = await drainMessages(options.getFollowUpMessages);
      if (followUps.length > 0) {
        pending = followUps.map((message) => ({
          message,
          source: "follow_up" as const,
        }));
        continue;
      }

      break;
    }

    return finish(onEvent, {
      finalText: lastText,
      turns,
      stopReason: "completed",
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

async function drainMessages(
  getter?: () => Promise<ChatMessage[]> | ChatMessage[],
): Promise<ChatMessage[]> {
  if (!getter) return [];
  return (await getter()) ?? [];
}

async function callLlm(
  llm: LlmChatPort,
  messages: ChatMessage[],
  tools: OpenAIToolDefinition[],
  onEvent: NonNullable<AgentLoopOptions["onEvent"]>,
  signal: AbortSignal | undefined,
  preferStream: boolean,
): Promise<ChatMessage> {
  if (preferStream && typeof llm.streamChat === "function") {
    await emitEvent(onEvent, { type: "message_start" });
    let final: ChatMessage | undefined;
    for await (const event of llm.streamChat(messages, { tools, signal })) {
      if (event.type === "text_delta" && event.text) {
        await emitEvent(onEvent, { type: "message_delta", text: event.text });
      } else if (event.type === "done") {
        final = event.result.message;
      }
    }
    if (!final) {
      throw new Error("LLM stream ended without a final message");
    }
    return final;
  }

  return llm.chat(messages, tools, { signal });
}

function ensureSystemMessage(options: AgentLoopOptions): void {
  const messages = options.session.getMessages();
  const hasSystem = messages.some((m) => m.role === "system");
  if (!hasSystem) {
    options.session.append({
      role: "system",
      content: buildSystemPrompt({
        workspace: options.workspace,
        mode: options.mode ?? "agent",
      }),
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
