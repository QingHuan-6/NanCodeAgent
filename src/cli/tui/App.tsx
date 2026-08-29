import React, { useCallback, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { runAgentLoop } from "../../agent/index.js";
import type { AgentEvent } from "../../agent/events.js";
import type { AgentLoopOptions } from "../../agent/types.js";
import type { Config } from "../../config/index.js";
import type { LlmClient } from "../../llm/client.js";
import type { Session } from "../../session/session.js";
import type { ToolRegistry } from "../../tools/registry.js";
import { helpText, parseSlashCommand } from "../slash.js";
import { DiffBlock } from "./DiffBlock.js";
import { theme } from "./theme.js";
import {
  nextId,
  summarizeArgs,
  type PermissionRequest,
  type StatusState,
  type TranscriptItem,
} from "./types.js";

export interface TuiAppProps {
  config: Config;
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
}

export function TuiApp(props: TuiAppProps): React.ReactElement {
  const { exit } = useApp();
  const config = props.config;
  const llm = props.llm;
  const tools = props.tools;
  const session = props.session;

  const [history, setHistory] = useState<TranscriptItem[]>([
    {
      id: nextId("sys"),
      kind: "system",
      text: `NanCodeAgent · ${config.model} · ${config.workspace}`,
    },
    {
      id: nextId("sys"),
      kind: "system",
      text: "Type a task · /help · Ctrl+J newline · Esc abort · /exit quit",
    },
  ]);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [status, setStatus] = useState<StatusState>({ phase: "idle" });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamBufRef = useRef("");

  const pushHistory = useCallback((item: TranscriptItem) => {
    setHistory((prev) => [...prev, item]);
  }, []);

  const onEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
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
          if (finalText) {
            pushHistory({
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
        case "tool_execution_start":
          setStatus({ phase: "tool", detail: event.toolName });
          pushHistory({
            id: nextId("tool"),
            kind: "tool",
            toolName: event.toolName,
            argsSummary: summarizeArgs(event.args),
          });
          break;
        case "tool_execution_end":
          // Static only renders new items — append result instead of mutating.
          pushHistory({
            id: nextId("tool-end"),
            kind: "tool",
            toolName: event.toolName,
            argsSummary: "",
            output: event.output,
            isError: event.isError,
            diff: event.ui?.diff,
          });
          break;
        case "error":
          pushHistory({
            id: nextId("err"),
            kind: "error",
            text: event.message,
          });
          break;
        case "agent_end":
          setStatus({ phase: "idle" });
          streamBufRef.current = "";
          setStreamBuffer("");
          break;
        default:
          break;
      }
    },
    [pushHistory],
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

  const runTask = useCallback(
    async (task: string) => {
      if (busy) return;
      setBusy(true);
      pushHistory({ id: nextId("user"), kind: "user", text: task });
      const ac = new AbortController();
      abortRef.current = ac;
      setStatus({ phase: "thinking", detail: "starting" });

      try {
        const options: AgentLoopOptions = {
          llm,
          tools,
          session,
          workspace: config.workspace,
          maxTurns: config.maxTurns,
          stream: true,
          onEvent,
          askPermission,
          signal: ac.signal,
        };
        await runAgentLoop(task, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushHistory({ id: nextId("err"), kind: "error", text: message });
      } finally {
        abortRef.current = null;
        setBusy(false);
        setStatus({ phase: "idle" });
        streamBufRef.current = "";
        setStreamBuffer("");
      }
    },
    [
      busy,
      llm,
      tools,
      session,
      config.workspace,
      config.maxTurns,
      onEvent,
      askPermission,
      pushHistory,
    ],
  );

  const handleSlash = useCallback(
    async (line: string): Promise<boolean> => {
      const slash = parseSlashCommand(line);
      if (!slash) return false;

      switch (slash.type) {
        case "exit":
          exit();
          return true;
        case "help":
          pushHistory({
            id: nextId("sys"),
            kind: "system",
            text: helpText(),
          });
          return true;
        case "clear":
          session.clear();
          setHistory([
            {
              id: nextId("sys"),
              kind: "system",
              text: "Session cleared.",
            },
          ]);
          return true;
        case "status":
          pushHistory({
            id: nextId("sys"),
            kind: "system",
            text: [
              `session:   ${session.id}`,
              `messages:  ${session.messageCount()}`,
              `model:     ${config.model}`,
              `base_url:  ${config.baseUrl}`,
              `workspace: ${config.workspace}`,
              `max_turns: ${config.maxTurns}`,
            ].join("\n"),
          });
          return true;
        case "setup":
          pushHistory({
            id: nextId("sys"),
            kind: "system",
            text: "Exit TUI and run: nan-agent --setup  (or nan-agent --plain then /setup)",
          });
          return true;
        case "unknown":
          pushHistory({
            id: nextId("sys"),
            kind: "system",
            text: `Unknown command: /${slash.name}. Type /help.`,
          });
          return true;
        default:
          return true;
      }
    },
    [exit, pushHistory, session, config],
  );

  const submit = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || busy || permission) return;
      setInput("");
      if (trimmed.startsWith("/")) {
        await handleSlash(trimmed);
        return;
      }
      await runTask(trimmed);
    },
    [busy, permission, handleSlash, runTask],
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

    if (key.escape && busy) {
      abortRef.current?.abort();
      return;
    }

    if (busy) return;

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
        return `Running ${status.detail ?? "tool"}…`;
      case "ask":
        return `Permission: ${status.detail}`;
      default:
        return "Ready";
    }
  }, [status]);

  return (
    <Box flexDirection="column" width="100%">
      <Static items={history}>
        {(item) => <HistoryLine key={item.id} item={item} />}
      </Static>

      {streamBuffer ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.brand} bold>
            assistant
          </Text>
          <Text color={theme.assistant}>{streamBuffer}</Text>
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
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
        ) : (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={theme.border}
            paddingX={1}
          >
            <Box>
              <Text color={theme.brand}>{"> "}</Text>
              <Text>
                {input.length > 0 ? input : ""}
                {input.length === 0 ? (
                  <Text dimColor>message…</Text>
                ) : null}
              </Text>
              {!busy ? <Text color={theme.brand}>█</Text> : null}
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
              {statusLabel} · enter send · ctrl+j newline
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function HistoryLine({ item }: { item: TranscriptItem }): React.ReactElement {
  switch (item.kind) {
    case "user":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.user} bold>
            you
          </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.brand} bold>
            assistant
          </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column" marginBottom={item.output || item.diff ? 1 : 0}>
          {item.argsSummary ? (
            <Text color={theme.tool}>
              ▸ {item.toolName}({item.argsSummary})
            </Text>
          ) : null}
          {item.diff ? (
            <DiffBlock diff={item.diff} />
          ) : item.output ? (
            <Text
              color={item.isError ? theme.error : undefined}
              dimColor={!item.isError}
            >
              {truncate(item.output, 600)}
            </Text>
          ) : null}
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

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
