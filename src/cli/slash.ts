/**
 * Slash commands for interactive TUI / REPL.
 */

export type SlashAction =
  | { type: "exit" }
  | { type: "help" }
  | { type: "clear" }
  | { type: "status" }
  | { type: "context" }
  | { type: "setup" }
  | { type: "continue" }
  | { type: "compact"; instructions?: string }
  | { type: "resume"; id?: string }
  | { type: "sessions" }
  | { type: "plan" }
  | { type: "agent" }
  | { type: "memory"; arg?: string }
  | { type: "web"; arg?: string }
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
    case "context":
    case "ctx":
      return { type: "context" };
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
    case "memory":
    case "mem":
      return { type: "memory", arg: arg || undefined };
    case "web":
    case "net":
    case "network":
      return { type: "web", arg: arg || undefined };
    default:
      return { type: "unknown", name: name || "?" };
  }
}

export function helpText(): string {
  return [
    "Commands:",
    "  /help       Show this help",
    "  /status     Session / model / workspace / mode / ctx%",
    "  /context    Context window estimate (usage anchor + rough)",
    "  /memory     Memory panel · /memory on|off|toggle [user|project]",
    "  /web        Web tools · /web on|off|toggle [user|project]",
    "  /plan       Read-only plan mode (read/glob/grep/todo/ask/web/lsp/skill/task/memory)",
    "  /agent      Full agent mode (write/edit/bash + ask/web/lsp/skill/task/memory)",
    "  /setup      Re-run API key / provider setup",
    "  /clear      Clear conversation history",
    "  /compact    Summarize older context (optional: /compact focus on auth)",
    "  /continue   Resume loop from last user/tool message",
    "  /sessions   List saved session ids (short + full)",
    "  /resume id  Load session (full id or suffix without session-)",
    "  /exit       Quit",
    "",
    "Composer: type / then ↑↓ to pick a command · Tab to complete",
    "While busy: Enter steers · Esc aborts · Ctrl+C copies selection (or aborts when busy)",
    "Tools: Ctrl+O detail · Ctrl+P/N focus · mouse scroll (OpenTUI sticky)",
    "",
    "Anything else is sent as a prompt (or steer when busy).",
  ].join("\n");
}
