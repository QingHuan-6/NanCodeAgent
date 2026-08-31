import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatGlobalAgentsSection,
  formatMemoryPromptSection,
  loadProgressMarkdown,
} from "../memory/index.js";
import { formatSkillsPromptSection } from "../skills/index.js";

const MAX_INSTRUCTION_CHARS = 8_000;

export interface SystemPromptOptions {
  workspace: string;
  /** Extra static instructions appended after the role section. */
  extraInstructions?: string;
  /** agent = full tools; plan = read-only exploration. */
  mode?: "agent" | "plan";
  /** When false, omit web_search / web_fetch guidance (tools not registered). */
  webEnabled?: boolean;
}

/**
 * Build system prompt: static role + dynamic runtime context.
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const workspace = path.resolve(options.workspace);
  const mode = options.mode ?? "agent";
  const web = options.webEnabled !== false;
  const sections: string[] = [
    buildRoleSection(mode, web),
    buildEnvironmentSection(workspace),
  ];

  const globalAgents = formatGlobalAgentsSection();
  if (globalAgents) {
    sections.push(globalAgents);
  }

  const projectInstructions = loadProjectInstructions(workspace);
  if (projectInstructions) {
    sections.push(`# Project instructions\n\n${projectInstructions}`);
  }

  const progress = loadProgressMarkdown(workspace);
  if (progress) {
    sections.push(`# Progress handoff\n\n${progress}`);
  }

  const memory = formatMemoryPromptSection(workspace);
  if (memory) {
    sections.push(memory);
  }

  const skills = formatSkillsPromptSection({ workspace });
  if (skills) {
    sections.push(skills);
  }

  if (options.extraInstructions?.trim()) {
    sections.push(`# Additional instructions\n\n${options.extraInstructions.trim()}`);
  }

  sections.push(buildToolPolicySection(mode, web));
  sections.push(buildReplyStyleSection());
  return sections.join("\n\n");
}

function buildRoleSection(mode: "agent" | "plan", web: boolean): string {
  const webHint = web
    ? "Use web_search/web_fetch for public docs; "
    : "";
  if (mode === "plan") {
    return [
      "# Role",
      "",
      "You are NanCodeAgent in plan mode (read-only).",
      "Explore with read_file / glob / grep; use todo_write for multi-step plans.",
      `Use ask_user when requirements are ambiguous; ${webHint}lsp for symbols/defs.`,
      "If an Available skill matches the task, call `skill` to load its instructions before planning.",
      "Use `memory` to read durable notes; prefer not to rewrite memory while only planning.",
      "For large investigation, use `task` with subagent_type=explorer (read-only child session).",
      "Do NOT modify files or run shell commands — those tools are unavailable.",
      "Produce a clear implementation plan: goals, files to touch, steps, risks.",
      "When the plan is ready, tell the user to switch to agent mode (/agent) to execute.",
    ].join("\n");
  }
  const lines = [
    "# Role",
    "",
    "You are NanCodeAgent, a local coding agent running on the user's machine.",
    "Complete programming tasks by calling tools to inspect and modify the workspace.",
    "Prefer small, correct edits. Prefer reading before writing. Verify with shell commands when useful.",
    "Use glob/grep to find files instead of guessing paths.",
    "If an Available skill matches the task, call `skill` to load full instructions before improvising.",
    "Use ask_user for clarifying product/API choices you cannot discover from the repo.",
  ];
  if (web) {
    lines.push(
      "Use web_search / web_fetch for public documentation (not private/local URLs).",
    );
  }
  lines.push(
    "Use lsp for go-to-definition, references, hover, and symbols when available.",
    "Use `task` to delegate: explorer (read-only research) or worker (bounded edits/bash). Default forks parent history; use fork_turns=none for a clean spawn. Pass task_id to resume.",
    "Use `memory` for durable cross-session notes (MEMORY.md index + topic files under the user memory dir).",
    "Never invent file contents — call read_file when unsure.",
    "If a tool fails, read the error, adjust, and retry with a different approach.",
    "If tool output was saved to .nan/tool-output/, use read_file to inspect the rest.",
  );
  return lines.join("\n");
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

function buildToolPolicySection(mode: "agent" | "plan", web: boolean): string {
  const planAllowed = web
    ? "read_file, glob, grep, todo_write, ask_user, web_fetch, web_search, lsp, skill, skill_install, task (explorer only), memory."
    : "read_file, glob, grep, todo_write, ask_user, lsp, skill, skill_install, task (explorer only), memory.";
  if (mode === "plan") {
    const lines = [
      "# Tool policy (plan mode)",
      "",
      `- Allowed: ${planAllowed}`,
      "- Forbidden: write_file, edit_file, bash, worker subagents, and any workspace mutation.",
      "- For multi-step plans, use todo_write to list concrete steps before finishing.",
      "- When a listed skill matches, call skill before drafting the plan.",
      "- To add a remote OpenCode-style catalog, use skill_install with an https base URL (index.json).",
      "- For heavy read-only research, call task with subagent_type=explorer; use the returned task_id to continue.",
      "- Read auto-memory with memory(operation=read|list); avoid large rewrites in plan mode.",
    ];
    if (web) {
      lines.push(
        "- Stay inside the workspace for file tools; web_* are for public internet only.",
      );
    } else {
      lines.push(
        "- Stay inside the workspace for file tools. Web tools are disabled (/web on to enable).",
      );
    }
    lines.push(
      "- End with a concrete plan the user can approve before switching to /agent.",
    );
    return lines.join("\n");
  }
  const lines = [
    "# Tool policy",
    "",
    "- Stay inside the workspace unless the user explicitly asks otherwise.",
    "- Avoid destructive shell commands (rm -rf, format, etc.).",
    "- For complex multi-step tasks (≥3 steps), call todo_write first, keep one item in_progress, and mark items completed as you go.",
    "- Prefer ask_user over guessing when a requirement has multiple valid product choices.",
    "- Prefer lsp over grepping blindly for definitions/references in TS/JS/Python.",
  ];
  if (web) {
    lines.push(
      "- Prefer web_fetch on a known docs URL; use web_search only when you need a starting point.",
    );
  } else {
    lines.push(
      "- Web tools are disabled; do not invent web_search/web_fetch calls (user can /web on).",
    );
  }
  lines.push(
    "- Prefer loading a matching skill with the skill tool before inventing a one-off workflow.",
    "- To install skills from the network, use skill_install with an OpenCode HTTP catalog URL (serves index.json), or write SKILL.md via skill-creator.",
    "- Use task for isolated research (explorer) or a bounded implementation slice (worker). Default fork_turns=all copies parent context (efficient); fork_turns=none for a blank specialist. Children cannot nest another task.",
    "- Resume a child with the same task_id + subagent_type from a prior <task_result>.",
    "- Use memory to record durable learnings (build commands, fixes, preferences). Keep MEMORY.md short; details in topic .md files.",
    "- For multi-hour work, maintain .nan/PROGRESS.md (or PROGRESS.md) with status and next steps so /compact or a new session can continue.",
    "- When editing, keep changes focused on the task.",
    "- When done, give a short summary of what changed.",
  );
  return lines.join("\n");
}

function buildReplyStyleSection(): string {
  return [
    "# Reply style (terminal)",
    "",
    "Write for a terminal transcript. Prefer short ## / ### headings, bullet lists, and `inline code` / fenced code blocks.",
    "Use [title](url) for links. Avoid decorative bold/italic; reserve emphasis for rare must-see warnings.",
    "Lead with the answer; skip long preambles. Keep summaries tight.",
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
