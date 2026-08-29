/**
 * Minimal slash commands for the interactive REPL.
 */

export type SlashAction =
  | { type: "exit" }
  | { type: "help" }
  | { type: "clear" }
  | { type: "status" }
  | { type: "setup" }
  | { type: "unknown"; name: string };

export function parseSlashCommand(line: string): SlashAction | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;

  const [rawName] = trimmed.slice(1).split(/\s+/);
  const name = (rawName ?? "").toLowerCase();

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
    default:
      return { type: "unknown", name: name || "?" };
  }
}

export function helpText(): string {
  return [
    "Commands:",
    "  /help     Show this help",
    "  /status   Session / model / workspace info",
    "  /setup    Re-run API key / provider setup",
    "  /clear    Clear conversation history (keep going in REPL)",
    "  /exit     Quit (/quit, /q)",
    "",
    "Anything else is sent to the agent.",
  ].join("\n");
}
