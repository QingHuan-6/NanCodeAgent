import React, { useCallback, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { AgentRuntime } from "../../agent/index.js";
import type { AgentEvent } from "../../agent/events.js";
import type { Config } from "../../config/index.js";
import type { LlmClient } from "../../llm/client.js";
import { Session } from "../../session/session.js";
import {
  clearTodos,
  loadPersistedTodos,
  summarizeTodos,
  type TodoItem,
} from "../../session/todo.js";
import type { ToolRegistry } from "../../tools/registry.js";
import { helpText, parseSlashCommand } from "../slash.js";
import {
  applyMemorySlash,
  parseMemorySlashArg,
} from "../../memory/index.js";
import { theme } from "./theme.js";
import { MarkdownView } from "./MarkdownView.js";
import { ToolCard } from "./ToolCard.js";
import {
  nextId,
  toolSubject,
  type PermissionRequest,
  type StatusState,
  type TimelineItem,
  type UserQuestionRequest,
} from "./types.js";

export interface TuiAppProps {
  config: Config;
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
}

/**
 * Chronological transcript TUI (OpenCode / Pi event order):
 *   user → assistant → tools (live update) → assistant → … → done
 * Footer stays: composer + status. No separate "tools dump" below history.
 */
export function TuiApp(props: TuiAppProps): React.ReactElement {
  const { exit } = useApp();
  const [config] = useState(props.config);
  const [llm] = useState(props.llm);
  const toolsReg = props.tools;
  const [session, setSession] = useState(props.session);

  const [timeline, setTimeline] = useState<TimelineItem[]>([
    {
      id: nextId("sys"),
      kind: "system",
      text: `NanCodeAgent · ${config.model} · ${config.workspace}`,
    },
    {
      id: nextId("sys"),
      kind: "system",
      text: "prompt · steer while busy · Esc abort · ctrl+o expand tool · /help",
    },
  ]);
  const [focusedToolId, setFocusedToolId] = useState<string | null>(null);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [status, setStatus] = useState<StatusState>({ phase: "idle" });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [userQuestion, setUserQuestion] = useState<UserQuestionRequest | null>(
    null,
  );
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const streamBufRef = useRef("");
  const runtimeRef = useRef<AgentRuntime | null>(null);

  const pushItem = useCallback((item: TimelineItem) => {
    setTimeline((prev) => [...prev, item]);
  }, []);

  const onEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "user_message":
          if (event.source === "steer" || event.source === "follow_up") {
            pushItem({
              id: nextId("user"),
              kind: "user",
              text: `[${event.source}] ${event.content}`,
            });
          }
          break;
        case "turn_start":
          setStatus({ phase: "thinking", detail: `turn ${event.turn}` });
          break;
        case "message_start":
          streamBufRef.current = "";
          setStreamBuffer("");
          setStatus({ phase: "streaming", detail: "assistant" });
          break;
        case "message_delta":
          streamBufRef.current += event.text;
          setStreamBuffer(streamBufRef.current);
          break;
        case "assistant_message": {
          const finalText = (
            streamBufRef.current ||
            event.content ||
            ""
          ).trimEnd();
          streamBufRef.current = "";
          setStreamBuffer("");
          // Only show real assistant prose in the timeline (no "(calling N tools)").
          if (finalText) {
            pushItem({
              id: nextId("asst"),
              kind: "assistant",
              text: finalText,
            });
          }
          if (event.toolCallCount > 0) {
            setStatus({
              phase: "tool",
              detail: `${event.toolCallCount} tool(s)`,
            });
          }
          break;
        }
        case "tool_execution_start": {
          const id = nextId("tool");
          setStatus({ phase: "tool", detail: event.toolName });
          setFocusedToolId(id);
          pushItem({
            id,
            kind: "tool",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            subject: toolSubject(event.toolName, event.args),
            status: "running",
            expanded: false,
          });
          break;
        }
        case "tool_execution_end":
          if (event.ui?.todos) {
            setTodos(event.ui.todos);
          }
          setTimeline((prev) => {
            const idx = findToolIndex(prev, event.toolCallId, event.toolName);
            if (idx < 0) {
              const id = nextId("tool");
              setFocusedToolId(id);
              return [
                ...prev,
                {
                  id,
                  kind: "tool" as const,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  subject: event.toolName,
                  status: (event.isError ? "error" : "done") as "error" | "done",
                  output: event.output,
                  diff: event.ui?.diff,
                  expanded: false,
                },
              ];
            }
            const copy = [...prev];
            const cur = copy[idx]!;
            if (cur.kind !== "tool") return prev;
            copy[idx] = {
              ...cur,
              status: event.isError ? "error" : "done",
              output: event.output,
              diff: event.ui?.diff,
              expanded: false,
            };
            setFocusedToolId(cur.id);
            return copy;
          });
          break;
        case "error":
          pushItem({
            id: nextId("err"),
            kind: "error",
            text: event.message,
          });
          break;
        case "agent_end":
          setStatus({ phase: "idle" });
          streamBufRef.current = "";
          setStreamBuffer("");
          pushItem({
            id: nextId("done"),
            kind: "done",
            reason: event.reason,
            turns: event.turns,
          });
          break;
        default:
          break;
      }
    },
    [pushItem],
  );

  const askPermission = useCallback(
    (reason: string, toolName: string): Promise<boolean> => {
      return new Promise((resolve) => {
        setStatus({ phase: "ask", detail: toolName });
        setPermission({
          toolName,
          reason,
          resolve: (allow) => {
            setPermission(null);
            setStatus({ phase: "tool", detail: toolName });
            resolve(allow);
          },
        });
      });
    },
    [],
  );

  const askUser = useCallback(
    (req: {
      question: string;
      options?: string[];
    }): Promise<string> => {
      return new Promise((resolve) => {
        setStatus({ phase: "ask", detail: "ask_user" });
        setInput("");
        setUserQuestion({
          question: req.question,
          options: req.options,
          resolve: (answer) => {
            setUserQuestion(null);
            setInput("");
            setStatus({ phase: "tool", detail: "ask_user" });
            resolve(answer);
          },
        });
      });
    },
    [],
  );

  const getRuntime = useCallback((): AgentRuntime => {
    if (
      !runtimeRef.current ||
      runtimeRef.current.session !== session ||
      runtimeRef.current.llm !== llm ||
      runtimeRef.current.config !== config
    ) {
      runtimeRef.current = new AgentRuntime({
        config,
        llm,
        tools: toolsReg,
        session,
        onEvent,
        askPermission,
        askUser,
      });
    } else {
      runtimeRef.current.onEvent = onEvent;
      runtimeRef.current.askPermission = askPermission;
      runtimeRef.current.askUser = askUser;
    }
    return runtimeRef.current;
  }, [config, llm, toolsReg, session, onEvent, askPermission, askUser]);

  const runPrompt = useCallback(
    async (task: string) => {
      const runtime = getRuntime();
      if (runtime.isRunning) {
        runtime.steer(task);
        pushItem({
          id: nextId("sys"),
          kind: "system",
          text: `Queued steer: ${task}`,
        });
        return;
      }
      setBusy(true);
      pushItem({ id: nextId("user"), kind: "user", text: task });
      setStatus({ phase: "thinking", detail: "starting" });
      try {
        await runtime.prompt(task);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushItem({ id: nextId("err"), kind: "error", text: message });
      } finally {
        setBusy(false);
        setStatus({ phase: "idle" });
        streamBufRef.current = "";
        setStreamBuffer("");
      }
    },
    [getRuntime, pushItem],
  );

  const runContinue = useCallback(async () => {
    const runtime = getRuntime();
    if (runtime.isRunning) {
      pushItem({
        id: nextId("sys"),
        kind: "system",
        text: "Agent is busy — wait or Esc abort first.",
      });
      return;
    }
    setBusy(true);
    pushItem({
      id: nextId("sys"),
      kind: "system",
      text: "Continuing from session…",
    });
    try {
      await runtime.continue();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushItem({ id: nextId("err"), kind: "error", text: message });
    } finally {
      setBusy(false);
      setStatus({ phase: "idle" });
    }
  }, [getRuntime, pushItem]);

  const toolIds = useMemo(
    () => timeline.filter((i) => i.kind === "tool").map((i) => i.id),
    [timeline],
  );

  const toggleFocusedTool = useCallback(() => {
    setTimeline((prev) => {
      const tools = prev.filter((i) => i.kind === "tool");
      if (tools.length === 0) return prev;
      const targetId =
        focusedToolId && tools.some((t) => t.id === focusedToolId)
          ? focusedToolId
          : tools[tools.length - 1]!.id;
      return prev.map((item) => {
        if (item.kind !== "tool" || item.id !== targetId) return item;
        if (item.status === "running") return item;
        if (!item.output && !item.diff) return item;
        return { ...item, expanded: !item.expanded };
      });
    });
  }, [focusedToolId]);

  const moveToolFocus = useCallback(
    (delta: number) => {
      if (toolIds.length === 0) return;
      const cur = focusedToolId ? toolIds.indexOf(focusedToolId) : -1;
      const base = cur < 0 ? toolIds.length - 1 : cur;
      const next = toolIds[(base + delta + toolIds.length) % toolIds.length]!;
      setFocusedToolId(next);
    },
    [toolIds, focusedToolId],
  );

  const handleSlash = useCallback(
    async (line: string): Promise<boolean> => {
      const slash = parseSlashCommand(line);
      if (!slash) return false;
      const runtime = getRuntime();

      switch (slash.type) {
        case "exit":
          exit();
          return true;
        case "help":
          pushItem({ id: nextId("sys"), kind: "system", text: helpText() });
          return true;
        case "clear":
          session.clear();
          clearTodos(session.id);
          setTodos([]);
          setFocusedToolId(null);
          setTimeline([
            {
              id: nextId("sys"),
              kind: "system",
              text: "Session cleared.",
            },
          ]);
          return true;
        case "status":
          pushItem({
            id: nextId("sys"),
            kind: "system",
            text: [
              `session:   ${session.id}`,
              `messages:  ${session.messageCount()}`,
              `mode:      ${runtime.mode}`,
              `todos:     ${todos.length ? summarizeTodos(todos) : "(none)"}`,
              `model:     ${config.model}`,
              `workspace: ${config.workspace}`,
              `running:   ${runtime.isRunning}`,
            ].join("\n"),
          });
          return true;
        case "memory": {
          const parsed = parseMemorySlashArg(slash.arg ?? "");
          if (parsed.kind === "error") {
            pushItem({
              id: nextId("sys"),
              kind: "system",
              text: parsed.message,
            });
            return true;
          }
          const text = applyMemorySlash(config.workspace, parsed);
          if (parsed.kind !== "status") {
            try {
              runtime.refreshSystemPrompt();
            } catch (err) {
              pushItem({
                id: nextId("err"),
                kind: "error",
                text: err instanceof Error ? err.message : String(err),
              });
            }
          }
          pushItem({
            id: nextId("sys"),
            kind: "system",
            text,
          });
          return true;
        }
        case "plan":
          try {
            runtime.setMode("plan");
            pushItem({
              id: nextId("sys"),
              kind: "system",
              text: "Plan mode on — read/glob/grep/todo/ask/web/lsp/skill/task/memory (no workspace writes).",
            });
          } catch (err) {
            pushItem({
              id: nextId("err"),
              kind: "error",
              text: err instanceof Error ? err.message : String(err),
            });
          }
          return true;
        case "agent":
          try {
            runtime.setMode("agent");
            pushItem({
              id: nextId("sys"),
              kind: "system",
              text: "Agent mode on — full tools enabled.",
            });
          } catch (err) {
            pushItem({
              id: nextId("err"),
              kind: "error",
              text: err instanceof Error ? err.message : String(err),
            });
          }
          return true;
        case "setup":
          pushItem({
            id: nextId("sys"),
            kind: "system",
            text: "Exit TUI and run: nan-agent --setup",
          });
          return true;
        case "continue":
          await runContinue();
          return true;
        case "compact": {
          try {
            const result = await runtime.compact({
              customInstructions: slash.instructions,
            });
            const detail =
              result.mode === "llm"
                ? `LLM summary (${result.summaryChars} chars), removed ~${result.removed} messages`
                : result.mode === "prune"
                  ? `Pruned ~${result.removed} messages (summarizer fallback)`
                  : "Nothing to compact";
            pushItem({
              id: nextId("sys"),
              kind: "system",
              text: `Compacted — ${detail}.`,
            });
          } catch (err) {
            pushItem({
              id: nextId("err"),
              kind: "error",
              text: err instanceof Error ? err.message : String(err),
            });
          }
          return true;
        }
        case "sessions": {
          const ids = Session.listSessionIds("sessions");
          pushItem({
            id: nextId("sys"),
            kind: "system",
            text:
              ids.length === 0
                ? "No saved sessions."
                : `Sessions:\n${ids.map((id) => `  ${id}`).join("\n")}`,
          });
          return true;
        }
        case "resume": {
          if (runtime.isRunning) {
            pushItem({
              id: nextId("sys"),
              kind: "system",
              text: "Cannot resume while running.",
            });
            return true;
          }
          if (!slash.id) {
            pushItem({
              id: nextId("sys"),
              kind: "system",
              text: "Usage: /resume <session-id>",
            });
            return true;
          }
          try {
            const loaded = Session.loadFromJsonl(`sessions/${slash.id}.jsonl`, {
              persistDir: "sessions",
            });
            setSession(loaded);
            runtimeRef.current = null;
            const restored =
              loadPersistedTodos(config.workspace, loaded.id) ?? [];
            setTodos(restored);
            pushItem({
              id: nextId("sys"),
              kind: "system",
              text: `Loaded ${loaded.id} (${loaded.messageCount()} msgs)${
                restored.length ? ` · ${summarizeTodos(restored)}` : ""
              }. /continue to resume.`,
            });
          } catch (err) {
            pushItem({
              id: nextId("err"),
              kind: "error",
              text: err instanceof Error ? err.message : String(err),
            });
          }
          return true;
        }
        case "unknown":
          pushItem({
            id: nextId("sys"),
            kind: "system",
            text: `Unknown: /${slash.name}. /help`,
          });
          return true;
        default:
          return true;
      }
    },
    [exit, pushItem, session, config, getRuntime, runContinue],
  );

  const submit = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || permission || userQuestion) return;
      setInput("");
      if (trimmed.startsWith("/")) {
        await handleSlash(trimmed);
        return;
      }
      await runPrompt(trimmed);
    },
    [permission, userQuestion, handleSlash, runPrompt],
  );

  useInput((ch, key) => {
    if (permission) {
      if (ch === "y" || ch === "Y") {
        permission.resolve(true);
        return;
      }
      if (ch === "n" || ch === "N" || key.return || key.escape) {
        permission.resolve(false);
        return;
      }
      return;
    }

    if (userQuestion) {
      const opts = userQuestion.options;
      if (opts && opts.length > 0 && ch && /^[1-8]$/.test(ch) && !input) {
        const idx = Number(ch) - 1;
        if (idx >= 0 && idx < opts.length) {
          userQuestion.resolve(opts[idx]!);
          return;
        }
      }
      if (key.return) {
        const answer = input.trim();
        if (answer) {
          userQuestion.resolve(answer);
        }
        return;
      }
      if (key.escape) {
        userQuestion.resolve("(user dismissed the question)");
        return;
      }
      if (key.ctrl && ch === "j") {
        setInput((v) => `${v}\n`);
        return;
      }
      if (key.backspace || key.delete) {
        setInput((v) => v.slice(0, -1));
        return;
      }
      if (ch && !key.ctrl && !key.meta) {
        setInput((v) => v + ch);
      }
      return;
    }

    if (key.ctrl && ch === "o") {
      toggleFocusedTool();
      return;
    }
    if (key.ctrl && ch === "p") {
      moveToolFocus(-1);
      return;
    }
    if (key.ctrl && ch === "n") {
      moveToolFocus(1);
      return;
    }

    if (key.escape && busy) {
      getRuntime().abort();
      return;
    }

    if (key.return) {
      void submit(input);
      return;
    }

    if (key.ctrl && ch === "j") {
      setInput((v) => `${v}\n`);
      return;
    }

    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }

    if (ch && !key.ctrl && !key.meta) {
      setInput((v) => v + ch);
    }
  });

  const statusLabel = useMemo(() => {
    switch (status.phase) {
      case "thinking":
        return `Thinking${status.detail ? ` (${status.detail})` : ""}…`;
      case "streaming":
        return "Streaming…";
      case "tool":
        return `Tools · ${status.detail ?? ""}`;
      case "ask":
        return status.detail === "ask_user"
          ? "Waiting for your answer…"
          : `Permission: ${status.detail}`;
      default:
        return busy ? "Busy · enter steers" : "Ready";
    }
  }, [status, busy]);

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column">
        {timeline.map((item) => (
          <TimelineRow
            key={item.id}
            item={item}
            focusedToolId={focusedToolId}
          />
        ))}
      </Box>

      {streamBuffer ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.brand} bold>
            Assistant
          </Text>
          <MarkdownView source={streamBuffer} />
          <Text dimColor>▊</Text>
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        {todos.length > 0 ? (
          <Box flexDirection="column" marginBottom={1} marginLeft={1}>
            <Text dimColor>● {summarizeTodos(todos)}</Text>
            {todos.slice(0, 8).map((t) => (
              <Text
                key={t.id}
                dimColor={t.status === "completed" || t.status === "cancelled"}
                color={
                  t.status === "in_progress"
                    ? theme.tool
                    : t.status === "completed"
                      ? theme.success
                      : undefined
                }
              >
                {"  "}
                {t.status === "completed"
                  ? "✔"
                  : t.status === "in_progress"
                    ? "◼"
                    : t.status === "cancelled"
                      ? "–"
                      : "◻"}{" "}
                {t.content}
              </Text>
            ))}
            {todos.length > 8 ? (
              <Text dimColor>  … +{todos.length - 8} more</Text>
            ) : null}
          </Box>
        ) : null}
        {permission ? (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={1}
          >
            <Text color="yellow">
              Allow {permission.toolName}? {permission.reason}
            </Text>
            <Text dimColor>[y] allow · [n] deny</Text>
          </Box>
        ) : userQuestion ? (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={theme.tool}
            paddingX={1}
          >
            <Text color={theme.tool} bold>
              Question
            </Text>
            <Text>{userQuestion.question}</Text>
            {userQuestion.options?.map((opt, i) => (
              <Text key={`${i}-${opt}`} dimColor>
                {"  "}
                [{i + 1}] {opt}
              </Text>
            ))}
            <Box marginTop={1}>
              <Text color={theme.brand}>{"> "}</Text>
              <Text>
                {input.length > 0 ? input : ""}
                {input.length === 0 ? (
                  <Text dimColor>
                    {userQuestion.options?.length
                      ? "1–8 or type answer…"
                      : "type answer…"}
                  </Text>
                ) : null}
              </Text>
              <Text color={theme.brand}>█</Text>
            </Box>
            <Text dimColor>
              Enter submit
              {userQuestion.options?.length ? " · digit picks option" : ""}
              {" · Esc skip"}
            </Text>
          </Box>
        ) : (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={theme.border}
            paddingX={1}
          >
            <Box>
              <Text color={theme.brand}>{busy ? "↗ " : "> "}</Text>
              <Text>
                {input.length > 0 ? input : ""}
                {input.length === 0 ? (
                  <Text dimColor>
                    {busy ? "steer…" : "message…"}
                  </Text>
                ) : null}
              </Text>
              <Text color={theme.brand}>█</Text>
            </Box>
          </Box>
        )}

        <Box>
          {status.phase !== "idle" && status.phase !== "ask" ? (
            <Text color={theme.brand}>
              <Spinner type="dots" /> {statusLabel}
            </Text>
          ) : (
            <Text dimColor>
              {statusLabel} · ctrl+o fold · ctrl+p/n tool
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function TimelineRow({
  item,
  focusedToolId,
}: {
  item: TimelineItem;
  focusedToolId: string | null;
}): React.ReactElement {
  switch (item.kind) {
    case "user":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.user} bold>
            You
          </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.brand} bold>
            Assistant
          </Text>
          <MarkdownView source={item.text} />
        </Box>
      );
    case "tool":
      return (
        <ToolCard card={item} focused={item.id === focusedToolId} />
      );
    case "done":
      return (
        <Box marginY={1}>
          <Text color={theme.success}>
            ── done ({item.reason}, {item.turns} turns) ──
          </Text>
        </Box>
      );
    case "error":
      return (
        <Text color={theme.error} bold>
          [error] {item.text}
        </Text>
      );
    case "system":
      return <Text dimColor>{item.text}</Text>;
    default:
      return <Text />;
  }
}

function findToolIndex(
  items: TimelineItem[],
  toolCallId: string,
  toolName: string,
): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const c = items[i]!;
    if (c.kind === "tool" && c.toolCallId === toolCallId) return i;
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const c = items[i]!;
    if (c.kind === "tool" && c.toolName === toolName && c.status === "running") {
      return i;
    }
  }
  return -1;
}
