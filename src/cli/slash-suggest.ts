/**
 * Slash command catalogue + prefix filter for TUI autocomplete.
 */

export interface SlashSuggestion {
  name: string;
  summary: string;
  /** Full insert text after `/`, e.g. "resume " or "memory on". */
  insert: string;
}

export const SLASH_SUGGESTIONS: SlashSuggestion[] = [
  { name: "help", summary: "Show commands", insert: "help" },
  { name: "status", summary: "Session / model / ctx%", insert: "status" },
  { name: "context", summary: "Context window estimate", insert: "context" },
  { name: "memory", summary: "Memory panel / on|off", insert: "memory" },
  { name: "web", summary: "Web tools on|off|toggle", insert: "web" },
  { name: "plan", summary: "Read-only plan mode", insert: "plan" },
  { name: "agent", summary: "Full agent mode", insert: "agent" },
  { name: "setup", summary: "Re-run API setup", insert: "setup" },
  { name: "clear", summary: "Clear conversation", insert: "clear" },
  { name: "compact", summary: "Summarize older context", insert: "compact" },
  { name: "continue", summary: "Continue from last turn", insert: "continue" },
  { name: "sessions", summary: "List saved sessions", insert: "sessions" },
  { name: "resume", summary: "Load session (id or suffix)", insert: "resume " },
  { name: "exit", summary: "Quit", insert: "exit" },
];

/** Filter suggestions while the user types `/hel` etc. */
export function filterSlashSuggestions(input: string): SlashSuggestion[] {
  if (!input.startsWith("/")) return [];
  const body = input.slice(1);
  // Only autocomplete the command token (before first space).
  if (body.includes(" ")) return [];
  const q = body.toLowerCase();
  if (!q) return SLASH_SUGGESTIONS;
  return SLASH_SUGGESTIONS.filter(
    (s) => s.name.startsWith(q) || s.insert.startsWith(q),
  );
}
