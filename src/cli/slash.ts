/**
 * Slash commands for interactive TUI / REPL.
 */

export type SlashAction =
  | { type: "exit" }
  | { type: "help" }
  | { type: "clear" }
  | { type: "status" }
  | { type: "setup" }
  | { type: "continue" }
  | { type: "compact"; instructions?: string }
  | { type: "resume"; id?: string }
  | { type: "sessions" }
  | { type: "plan" }
  | { type: "agent" }
  | { type: "unknown"; name: string };

export function parseSlashCommand(line: string): SlashAction | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const name = (parts[0] ?? "").toLowerCase();
  const arg = parts.slice(1).join(" ").trim();

  switch (name) {
    case "exit":
    case "quit":
    case "q":
      return { type: "exit" };
    case "help":
    case "h":
    case "?":
      return { type: "help" };
    case "clear":
      return { type: "clear" };
    case "status":
      return { type: "status" };
    case "setup":
    case "config":
      return { type: "setup" };
    case "continue":
    case "cont":
      return { type: "continue" };
    case "compact":
      return arg
        ? { type: "compact", instructions: arg }
        : { type: "compact" };
    case "resume":
      return { type: "resume", id: arg || undefined };
    case "sessions":
    case "session":
      return { type: "sessions" };
    case "plan":
      return { type: "plan" };
    case "agent":
    case "code":
    case "act":
      return { type: "agent" };
    default:
      return { type: "unknown", name: name || "?" };
  }
}

export function helpText(): string {
  return [
    "Commands:",
    "  /help       Show this help",
    "  /status     Session / model / workspace / mode",
    "  /plan       Read-only plan mode (read/glob/grep/todo/ask/web/lsp/skill/task)",
    "  /agent      Full agent mode (write/edit/bash + ask/web/lsp/skill/task)",
    "  /setup      Re-run API key / provider setup",
    "  /clear      Clear conversation history",
    "  /compact    Summarize older context (optional: /compact focus on auth)",
    "  /continue   Resume loop from last user/tool message",
    "  /sessions   List saved session ids",
    "  /resume id  Load a saved session",
    "  /exit       Quit",
    "",
    "While busy (TUI): Enter steers · Esc aborts · Ctrl+O folds tools",
    "",
    "Anything else is sent as a prompt (or steer when busy).",
  ].join("\n");
}
