import { spawn } from "node:child_process";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  optionalNumber,
  requireString,
  truncateOutput,
} from "./helpers.js";
import type { ToolDefinition } from "./types.js";

/** Run a shell command with cwd = workspace. */
export const bashTool: ToolDefinition = {
  name: "bash",
  description:
    "Run a shell command inside the workspace directory. Returns stdout, stderr, and exit code. Use for builds, tests, git, and other CLI checks.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to execute",
      },
      timeout_ms: {
        type: "number",
        description: `Timeout in milliseconds (default ${DEFAULT_BASH_TIMEOUT_MS})`,
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const command = requireString(args, "command").trim();
    if (!command) throw new Error("command must not be empty");

    const timeoutMs = optionalNumber(args, "timeout_ms") ?? DEFAULT_BASH_TIMEOUT_MS;
    if (timeoutMs <= 0) throw new Error("timeout_ms must be > 0");

    const result = await runShell(command, ctx.workspace, timeoutMs);
    const parts = [
      `exit_code: ${result.exitCode ?? "(none)"}`,
      result.timedOut ? "timed_out: true" : null,
      "",
      "stdout:",
      result.stdout || "(empty)",
      "",
      "stderr:",
      result.stderr || "(empty)",
    ].filter((line) => line !== null);

    return { output: truncateOutput(parts.join("\n")) };
  },
};

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2000).unref();
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) stdout = stdout.slice(0, 2_000_000);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 2_000_000) stderr = stderr.slice(0, 2_000_000);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: timedOut
          ? `${stderr}\n[process timed out after ${timeoutMs}ms]`.trim()
          : stderr,
        exitCode: code,
        timedOut,
      });
    });
  });
}
