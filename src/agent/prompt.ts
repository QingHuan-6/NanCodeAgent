import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_INSTRUCTION_CHARS = 8_000;

export interface SystemPromptOptions {
  workspace: string;
  /** Extra static instructions appended after the role section. */
  extraInstructions?: string;
}

/**
 * Build system prompt: static role + dynamic runtime context
 * (inspired by claw-code `prompt.rs` assembly, simplified).
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const workspace = path.resolve(options.workspace);
  const sections: string[] = [buildRoleSection(), buildEnvironmentSection(workspace)];

  const projectInstructions = loadProjectInstructions(workspace);
  if (projectInstructions) {
    sections.push(`# Project instructions\n\n${projectInstructions}`);
  }

  if (options.extraInstructions?.trim()) {
    sections.push(`# Additional instructions\n\n${options.extraInstructions.trim()}`);
  }

  sections.push(buildToolPolicySection());
  return sections.join("\n\n");
}

function buildRoleSection(): string {
  return [
    "# Role",
    "",
    "You are NanCodeAgent, a local coding agent running on the user's machine.",
    "Complete programming tasks by calling tools to inspect and modify the workspace.",
    "Prefer small, correct edits. Prefer reading before writing. Verify with shell commands when useful.",
    "Never invent file contents — call read_file when unsure.",
    "If a tool fails, read the error, adjust, and retry with a different approach.",
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

function buildToolPolicySection(): string {
  return [
    "# Tool policy",
    "",
    "- Stay inside the workspace unless the user explicitly asks otherwise.",
    "- Avoid destructive shell commands (rm -rf, format, etc.).",
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
