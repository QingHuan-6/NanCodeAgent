import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  AgentRuntime,
  formatContextBreakdown,
  formatContextLine,
} from "../../agent/index.js";
import type { AgentEvent } from "../../agent/events.js";
import type { ContextEstimate } from "../../agent/tokens.js";
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
import { ToolDetailPanel } from "./ToolDetail.js";
import { timelineFromMessages } from "./resume-timeline.js";
import {
  nextId,
  toolSubject,
  type PermissionRequest,
  type StatusState,
  type TimelineItem,
  type UserQuestionRequest,
} from "./types.js";

const STREAM_FLUSH_MS = 48;

export interface TuiAppProps {
  config: Config;
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
  onExit: () => void;
}

/**
 * OpenTUI transcript (same toolkit as OpenCode):
 * sticky ScrollBox + fixed composer / tool-detail chrome.
 */
export function TuiApp(props: TuiAppProps): ReactNode {
  const { onExit } = props;
  const { width, height } = useTerminalDimensions();
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
      text: "OpenTUI · scroll wheel / sticky · ctrl+o tool · ctrl+p/n · /help",
    },
  ]);
  const [focusedToolId, setFocusedToolId] = useState<string | null>(null);
  const [toolDetailOpen, setToolDetailOpen] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [status, setStatus] = useState<StatusState>({ phase: "idle" });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [userQuestion, setUserQuestion] = useState<UserQuestionRequest | null>(
    null,
  );
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [ctxEstimate, setCtxEstimate] = useState<ContextEstimate | null>(null);

  const streamBufRef = useRef("");
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const runtimeRef = useRef<AgentRuntime | null>(null);

  const flushStreamBuffer = useCallback(() => {
    if (streamFlushTimerRef.current) {
      clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
    setStreamBuffer(streamBufRef.current);
  }, []);

  const scheduleStreamFlush = useCallback(() => {
    if (streamFlushTimerRef.current) return;
    streamFlushTimerRef.current = setTimeout(() => {
      streamFlushTimerRef.current = null;
      setStreamBuffer(streamBufRef.current);
    }, STREAM_FLUSH_MS);
  }, []);

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
          if (streamFlushTimerRef.current) {
            clearTimeout(streamFlushTimerRef.current);
            streamFlushTimerRef.current = null;
          }
          streamBufRef.current = "";
          setStreamBuffer("");
          setStatus({ phase: "streaming", detail: "assistant" });
          break;
        case "message_delta":
          streamBufRef.current += event.text;
          scheduleStreamFlush();
          break;
        case "assistant_message": {
          flushStreamBuffer();
          const finalText = (
            streamBufRef.current ||
            event.content ||
            ""
          ).trimEnd();
          streamBufRef.current = "";
          setStreamBuffer("");
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
        case "context_usage":
          setCtxEstimate(event.estimate);
          break;
        case "error":
          pushItem({
            id: nextId("err"),
            kind: "error",
            text: event.message,
          });
          break;
        case "agent_end":
          flushStreamBuffer();
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
    [pushItem, scheduleStreamFlush, flushStreamBuffer],
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

  const tools = useMemo(
    () =>
      timeline.filter(
        (i): i is Extract<TimelineItem, { kind: "tool" }> => i.kind === "tool",
      ),
    [timeline],
  );

  const toolIds = useMemo(() => tools.map((t) => t.id), [tools]);

  const focusedTool = useMemo(() => {
    if (focusedToolId) {
      const hit = tools.find((t) => t.id === focusedToolId);
      if (hit) return hit;
    }
    return tools.length > 0 ? tools[tools.length - 1]! : null;
  }, [tools, focusedToolId]);

  const focusedToolIndex = useMemo(() => {
    if (!focusedTool) return -1;
    return tools.findIndex((t) => t.id === focusedTool.id);
  }, [tools, focusedTool]);

  const toggleToolDetail = useCallback(() => {
    if (tools.length === 0) return;
    const target =
      focusedToolId && tools.some((t) => t.id === focusedToolId)
        ? focusedToolId
        : tools[tools.length - 1]!.id;
    const tool = tools.find((t) => t.id === target);
    if (!tool || tool.status === "running") return;
    if (!tool.output && !tool.diff) return;
    setFocusedToolId(target);
    setToolDetailOpen((open) => !open);
  }, [tools, focusedToolId]);

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
          onExit();
          return true;
        case "help":
          pushItem({ id: nextId("sys"), kind: "system", text: helpText() });
          return true;
        case "clear":
          session.clear();
          clearTodos(session.id);
          setTodos([]);
          setFocusedToolId(null);
          setToolDetailOpen(false);
          setCtxEstimate(null);
          setTimeline([
            {
              id: nextId("sys"),
              kind: "system",
              text: "Session cleared.",
            },
          ]);
          return true;
        case "status": {
          const est = runtime.getContextEstimate();
          setCtxEstimate(est);
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
              `context:   ${formatContextLine(est)}`,
            ].join("\n"),
          });
          return true;
        }
        case "context": {
          const est = runtime.getContextEstimate();
          setCtxEstimate(est);
          pushItem({
            id: nextId("sys"),
            kind: "system",
            text: formatContextBreakdown(est, session.getMessages()),
          });
          return true;
        }
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
          pushItem({ id: nextId("sys"), kind: "system", text });
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
            const rebuilt = timelineFromMessages(loaded.getMessages());
            setTimeline([
              {
                id: nextId("sys"),
                kind: "system",
                text: `NanCodeAgent · ${config.model} · ${config.workspace}`,
              },
              ...rebuilt,
              {
                id: nextId("sys"),
                kind: "system",
                text: `Loaded ${loaded.id} (${loaded.messageCount()} msgs)${
                  restored.length ? ` · ${summarizeTodos(restored)}` : ""
                }. /continue to resume.`,
              },
            ]);
            setFocusedToolId(null);
            setToolDetailOpen(false);
            setCtxEstimate(null);
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
    [
      onExit,
      pushItem,
      session,
      config,
      getRuntime,
      runContinue,
      todos.length,
    ],
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

  useKeyboard((key) => {
    if (key.eventType === "release") return;

    if (permission) {
      if (key.name === "y") {
        permission.resolve(true);
        key.preventDefault();
        return;
      }
      if (key.name === "n" || key.name === "escape" || key.name === "return") {
        permission.resolve(false);
        key.preventDefault();
        return;
      }
      return;
    }

    if (userQuestion) {
      const opts = userQuestion.options;
      if (opts && opts.length > 0 && /^[1-8]$/.test(key.name) && !input) {
        const idx = Number(key.name) - 1;
        if (idx >= 0 && idx < opts.length) {
          userQuestion.resolve(opts[idx]!);
          key.preventDefault();
          return;
        }
      }
      if (key.name === "escape") {
        userQuestion.resolve("(user dismissed the question)");
        key.preventDefault();
        return;
      }
      return;
    }

    if (key.ctrl && key.name === "o") {
      toggleToolDetail();
      key.preventDefault();
      return;
    }
    if (key.ctrl && key.name === "p") {
      moveToolFocus(-1);
      key.preventDefault();
      return;
    }
    if (key.ctrl && key.name === "n") {
      moveToolFocus(1);
      key.preventDefault();
      return;
    }

    if (key.name === "escape" && toolDetailOpen) {
      setToolDetailOpen(false);
      key.preventDefault();
      return;
    }

    if (key.name === "escape" && busy) {
      getRuntime().abort();
      key.preventDefault();
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

  const ctxFooter = useMemo(() => {
    if (!ctxEstimate) return "ctx —";
    const pct = Math.round(ctxEstimate.usedRatio * 100);
    return `ctx ~${pct}%`;
  }, [ctxEstimate]);

  const composerFocused = !permission;
  const chromeHint = permission
    ? "[y] allow · [n] deny"
    : userQuestion
      ? "Enter submit · Esc skip"
      : "ctrl+o tool · ctrl+p/n · scroll sticky";

  return (
    <box
      width={width}
      height={height}
      flexDirection="column"
      backgroundColor={theme.bg}
    >
      <scrollbox
        stickyScroll
        stickyStart="bottom"
        scrollY
        viewportCulling
        flexGrow={1}
        width="100%"
        focused={false}
        style={{
          rootOptions: { backgroundColor: theme.bg },
          viewportOptions: { backgroundColor: theme.bg },
          contentOptions: { backgroundColor: theme.bg },
          scrollbarOptions: {
            trackOptions: {
              foregroundColor: theme.brand,
              backgroundColor: theme.panel,
            },
          },
        }}
      >
        {timeline.map((item) => (
          <TimelineRow
            key={item.id}
            item={item}
            focusedToolId={focusedToolId}
            toolDetailOpen={toolDetailOpen}
          />
        ))}
        {streamBuffer ? (
          <box flexDirection="column" marginBottom={1}>
            <text fg={theme.brand}>Assistant</text>
            <MarkdownView source={streamBuffer} />
            <text fg={theme.dim}>▊</text>
          </box>
        ) : null}
      </scrollbox>

      <box flexDirection="column" flexShrink={0} width="100%">
        {toolDetailOpen && focusedTool ? (
          <ToolDetailPanel
            tool={focusedTool}
            index={Math.max(0, focusedToolIndex)}
            total={tools.length}
          />
        ) : null}

        {todos.length > 0 ? (
          <box flexDirection="column" marginBottom={1} marginLeft={1}>
            <text fg={theme.dim}>{`● ${summarizeTodos(todos)}`}</text>
            {todos.slice(0, 8).map((t) => (
              <text
                key={t.id}
                fg={
                  t.status === "in_progress"
                    ? theme.tool
                    : t.status === "completed"
                      ? theme.success
                      : theme.dim
                }
              >
                {`  ${
                  t.status === "completed"
                    ? "✔"
                    : t.status === "in_progress"
                      ? "◼"
                      : t.status === "cancelled"
                        ? "–"
                        : "◻"
                } ${t.content}`}
              </text>
            ))}
            {todos.length > 8 ? (
              <text fg={theme.dim}>{`  … +${todos.length - 8} more`}</text>
            ) : null}
          </box>
        ) : null}

        {permission ? (
          <box
            border
            borderColor="#eab308"
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
          >
            <text fg="#eab308">
              {`Allow ${permission.toolName}? ${permission.reason}`}
            </text>
            <text fg={theme.dim}>[y] allow · [n] deny</text>
          </box>
        ) : userQuestion ? (
          <box
            border
            borderColor={theme.tool}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
          >
            <text fg={theme.tool}>Question</text>
            <text>{userQuestion.question}</text>
            {userQuestion.options?.map((opt, i) => (
              <text key={`${i}-${opt}`} fg={theme.dim}>
                {`  [${i + 1}] ${opt}`}
              </text>
            ))}
            <input
              focused={composerFocused}
              value={input}
              onInput={setInput}
              onSubmit={() => {
                const answer = input.trim();
                if (answer) userQuestion.resolve(answer);
              }}
              placeholder={
                userQuestion.options?.length
                  ? "1–8 or type answer…"
                  : "type answer…"
              }
              width="100%"
            />
          </box>
        ) : (
          <box
            border
            borderColor={theme.border}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
          >
            <input
              focused={composerFocused}
              value={input}
              onInput={setInput}
              onSubmit={() => {
                void submit(input);
              }}
              placeholder={busy ? "steer…" : "message…"}
              width="100%"
            />
          </box>
        )}

        <box
          width="100%"
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={status.phase !== "idle" && status.phase !== "ask" ? theme.brand : theme.dim}>
            {`${status.phase !== "idle" && status.phase !== "ask" ? "… " : ""}${statusLabel} · ${chromeHint}`}
          </text>
          <text fg={theme.dim}>
            {`${config.model} · ${runtimeRef.current?.mode ?? "agent"} · ${ctxFooter}`}
          </text>
        </box>
      </box>
    </box>
  );
}

function TimelineRow({
  item,
  focusedToolId,
  toolDetailOpen,
}: {
  item: TimelineItem;
  focusedToolId: string | null;
  toolDetailOpen: boolean;
}): ReactNode {
  switch (item.kind) {
    case "user":
      return (
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.user}>You</text>
          <text>{item.text}</text>
        </box>
      );
    case "assistant":
      return (
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.brand}>Assistant</text>
          <MarkdownView source={item.text} />
        </box>
      );
    case "tool":
      return (
        <ToolCard
          card={item}
          focused={item.id === focusedToolId}
          detailOpen={toolDetailOpen}
        />
      );
    case "done":
      return (
        <box marginTop={1} marginBottom={1}>
          <text fg={theme.success}>
            {`── done (${item.reason}, ${item.turns} turns) ──`}
          </text>
        </box>
      );
    case "error":
      return (
        <text fg={theme.error}>{`[error] ${item.text}`}</text>
      );
    case "system":
      return <text fg={theme.dim}>{item.text}</text>;
    default:
      return <text />;
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
