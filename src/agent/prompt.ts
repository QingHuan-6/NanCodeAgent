/**
 * Build the system prompt injected at the start of each session.
 */
export function buildSystemPrompt(workspace: string): string {
  const now = new Date().toISOString();
  return [
    "You are NanCodeAgent, a local coding agent.",
    "You complete programming tasks by calling tools to read/write files and run shell commands.",
    "Prefer small, correct edits. After changing code, verify with commands when useful.",
    "Do not invent file contents — use read_file when unsure.",
    `Workspace root: ${workspace}`,
    `Current time (UTC): ${now}`,
  ].join("\n");
}
