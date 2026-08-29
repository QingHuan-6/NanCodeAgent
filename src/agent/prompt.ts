import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_INSTRUCTION_CHARS = 8_000;

export interface SystemPromptOptions {
  workspace: string;
  /** Extra static instructions appended after the role section. */
  extraInstructions?: string;
  /** agent = full tools; plan = read-only exploration. */
  mode?: "agent" | "plan";
}

/**
 * Build system prompt: static role + dynamic runtime context.
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const workspace = path.resolve(options.workspace);
  const mode = options.mode ?? "agent";
  const sections: string[] = [
    buildRoleSection(mode),
    buildEnvironmentSection(workspace),
  ];

  const projectInstructions = loadProjectInstructions(workspace);
  if (projectInstructions) {
    sections.push(`# Project instructions\n\n${projectInstructions}`);
  }

  if (options.extraInstructions?.trim()) {
    sections.push(`# Additional instructions\n\n${options.extraInstructions.trim()}`);
  }

  sections.push(buildToolPolicySection(mode));
  return sections.join("\n\n");
}

function buildRoleSection(mode: "agent" | "plan"): string {
  if (mode === "plan") {
    return [
      "# Role",
      "",
      "You are NanCodeAgent in **plan mode** (read-only).",
      "Explore with read_file / glob / grep; use todo_write for multi-step plans.",
      "Use ask_user when requirements are ambiguous; web_search/web_fetch for public docs; lsp for symbols/defs.",
      "Do NOT modify files or run shell commands — those tools are unavailable.",
      "Produce a clear implementation plan: goals, files to touch, steps, risks.",
      "When the plan is ready, tell the user to switch to agent mode (/agent) to execute.",
    ].join("\n");
  }
  return [
    "# Role",
    "",
    "You are NanCodeAgent, a local coding agent running on the user's machine.",
    "Complete programming tasks by calling tools to inspect and modify the workspace.",
    "Prefer small, correct edits. Prefer reading before writing. Verify with shell commands when useful.",
    "Use glob/grep to find files instead of guessing paths.",
    "Use ask_user for clarifying product/API choices you cannot discover from the repo.",
    "Use web_search / web_fetch for public documentation (not private/local URLs).",
    "Use lsp for go-to-definition, references, hover, and symbols when available.",
    "Never invent file contents — call read_file when unsure.",
    "If a tool fails, read the error, adjust, and retry with a different approach.",
    "If tool output was saved to .nan/tool-output/, use read_file to inspect the rest.",
  ].join("\n");
}

function buildEnvironmentSection(workspace: string): string {
  const lines = [
    "# Environment",
    "",
    `- Workspace: ${workspace}`,
    `- OS: ${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    `- Shell hint: ${process.env.ComSpec ? "Windows cmd/PowerShell available" : "Unix-like shell"}`,
    `- Date (UTC): ${new Date().toISOString().slice(0, 10)}`,
  ];

  const git = tryGitSummary(workspace);
  if (git) {
    lines.push(`- Git: ${git}`);
  }

  return lines.join("\n");
}

function buildToolPolicySection(mode: "agent" | "plan"): string {
  if (mode === "plan") {
    return [
      "# Tool policy (plan mode)",
      "",
      "- Allowed: read_file, glob, grep, todo_write, ask_user, web_fetch, web_search, lsp.",
      "- Forbidden: write_file, edit_file, bash, and any workspace mutation.",
      "- For multi-step plans, use todo_write to list concrete steps before finishing.",
      "- Stay inside the workspace for file tools; web_* are for public internet only.",
      "- End with a concrete plan the user can approve before switching to /agent.",
    ].join("\n");
  }
  return [
    "# Tool policy",
    "",
    "- Stay inside the workspace unless the user explicitly asks otherwise.",
    "- Avoid destructive shell commands (rm -rf, format, etc.).",
    "- For complex multi-step tasks (≥3 steps), call todo_write first, keep one item in_progress, and mark items completed as you go.",
    "- Prefer ask_user over guessing when a requirement has multiple valid product choices.",
    "- Prefer lsp over grepping blindly for definitions/references in TS/JS/Python.",
    "- Prefer web_fetch on a known docs URL; use web_search only when you need a starting point.",
    "- When editing, keep changes focused on the task.",
    "- When done, give a short summary of what changed.",
  ].join("\n");
}

/**
 * Load AGENTS.md / CLAUDE.md / .nan/AGENTS.md if present (claw-code instruction files idea).
 */
export function loadProjectInstructions(workspace: string): string | null {
  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    path.join(".nan", "AGENTS.md"),
    path.join(".cursor", "rules"), // directory handled below
  ];

  const chunks: string[] = [];
  let remaining = MAX_INSTRUCTION_CHARS;

  for (const relative of candidates) {
    if (remaining <= 0) break;
    const absolute = path.join(workspace, relative);
    try {
      const stat = fs.statSync(absolute);
      if (stat.isFile()) {
        const text = truncate(fs.readFileSync(absolute, "utf8"), remaining);
        chunks.push(`## ${relative}\n\n${text}`);
        remaining -= text.length;
      } else if (stat.isDirectory() && relative.endsWith("rules")) {
        const files = fs
          .readdirSync(absolute)
          .filter((f) => f.endsWith(".md") || f.endsWith(".mdc"))
          .sort()
          .slice(0, 5);
        for (const file of files) {
          if (remaining <= 0) break;
          const text = truncate(
            fs.readFileSync(path.join(absolute, file), "utf8"),
            remaining,
          );
          chunks.push(`## ${relative}/${file}\n\n${text}`);
          remaining -= text.length;
        }
      }
    } catch {
      // missing is fine
    }
  }

  return chunks.length > 0 ? chunks.join("\n\n") : null;
}

function tryGitSummary(workspace: string): string | null {
  try {
    // Avoid spawning git if .git is missing
    if (!fs.existsSync(path.join(workspace, ".git"))) return null;
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: workspace,
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dirty = execSync("git status --porcelain", {
      cwd: workspace,
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return dirty ? `${branch} (dirty)` : `${branch} (clean)`;
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 20))}\n…[truncated]`;
}
