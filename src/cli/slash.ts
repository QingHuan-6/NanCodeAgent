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
  | { type: "compact" }
  | { type: "resume"; id?: string }
  | { type: "sessions" }
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
      return { type: "compact" };
    case "resume":
      return { type: "resume", id: arg || undefined };
    case "sessions":
    case "session":
      return { type: "sessions" };
    default:
      return { type: "unknown", name: name || "?" };
  }
}

export function helpText(): string {
  return [
    "Commands:",
    "  /help       Show this help",
    "  /status     Session / model / workspace info",
    "  /setup      Re-run API key / provider setup (--plain or --setup)",
    "  /clear      Clear conversation history",
    "  /compact    Prune older context (keep recent tool-safe blocks)",
    "  /continue   Resume loop from last user/tool message (no new prompt)",
    "  /sessions   List saved session ids",
    "  /resume id  Load a saved session from sessions/",
    "  /exit       Quit (/quit, /q)",
    "",
    "While the agent is running (TUI):",
    "  Enter       Steer — inject after current tools finish",
    "  Esc         Abort the current run",
    "  Ctrl+O      Expand / collapse focused tool result",
    "  Ctrl+P/N    Focus previous / next tool card",
    "",
    "Anything else is sent as a new prompt (or steer when busy).",
  ].join("\n");
}
