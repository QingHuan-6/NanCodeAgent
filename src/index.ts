#!/usr/bin/env node
/**
 * NanCodeAgent CLI entry.
 *
 * Usage:
 *   nan-agent                 # interactive TUI (first run → setup)
 *   nan-agent --plain         # classic readline REPL
 *   nan-agent --setup         # re-run API key setup
 *   nan-agent "one task"      # one-shot (streaming printer)
 *   npm run dev               # same, from source via tsx
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgentLoop } from "./agent/index.js";
import { createDefaultTransformContext } from "./agent/context.js";
import { ensureOpenTuiRuntime } from "./cli/ensure-opentui-runtime.js";
import { createPrinter } from "./cli/printer.js";
import { runRepl } from "./cli/repl.js";
import { runSetupWizard } from "./cli/setup.js";
import { runTui } from "./cli/tui/index.js";
import {
  hasApiKeyConfigured,
  loadConfig,
  loadEnvFiles,
} from "./config/index.js";
import { LlmClient } from "./llm/index.js";
import { Session } from "./session/session.js";
import { syncConfiguredSkillSources } from "./skills/discover.js";
import { createDefaultRegistry } from "./tools/index.js";

function printHelp(): void {
  console.log(`NanCodeAgent

Usage:
  nan-agent                 Start interactive TUI
  nan-agent --plain         Classic readline REPL
  nan-agent "task"          Run one task and exit
  nan-agent --setup         Configure API key / provider
  nan-agent --help          Show this help

TUI (OpenTUI): Node.js >= 26.4 (auto --experimental-ffi) or Bun
Config: %USERPROFILE%\\.nan-agent\\.env  (created on first setup)
Workspace: current directory
`);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printHelp();
    return;
  }

  const setupOnly = rawArgs.includes("--setup");
  const plain = rawArgs.includes("--plain");
  const args = rawArgs.filter(
    (a) =>
      a !== "--chat" &&
      a !== "--setup" &&
      a !== "--help" &&
      a !== "-h" &&
      a !== "--plain",
  );
  const oneShot = args.join(" ").trim();

  loadEnvFiles();

  if (setupOnly || !hasApiKeyConfigured()) {
    if (!input.isTTY) {
      console.error(
        "NAN_API_KEY is missing. Set it in the environment, or run in a terminal to use the setup wizard.",
      );
      process.exit(1);
    }
    await runSetupWizard();
    if (setupOnly && !oneShot) {
      console.log("Setup complete. Run `nan-agent` to start.");
      return;
    }
  }

  const config = loadConfig();
  const llm = new LlmClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
  });
  const tools = createDefaultRegistry({ workspace: config.workspace });
  const session = new Session({ persistDir: "sessions" });

  if (!oneShot) {
    if (!input.isTTY) {
      console.error(
        'Interactive mode needs a TTY. Pass a task:\n  nan-agent "your task"',
      );
      process.exit(1);
    }
    if (plain) {
      await runRepl({ config, llm, tools, session });
    } else {
      // OpenTUI: Node >= 26.4 needs --experimental-ffi (auto re-exec).
      ensureOpenTuiRuntime();
      await runTui({ config, llm, tools, session });
    }
    return;
  }

  await syncConfiguredSkillSources(config.workspace);

  await runAgentLoop(oneShot, {
    llm,
    tools,
    session,
    workspace: config.workspace,
    maxTurns: config.maxTurns,
    stream: true,
    toolExecution: "parallel",
    onEvent: createPrinter(),
    transformContext: createDefaultTransformContext(),
    askPermission: async (reason, toolName) => {
      if (!input.isTTY) return false;
      const rl = readline.createInterface({ input, output });
      try {
        const answer = (
          await rl.question(`[ask] Allow ${toolName}? ${reason} [y/N] `)
        )
          .trim()
          .toLowerCase();
        return answer === "y" || answer === "yes";
      } finally {
        rl.close();
      }
    },
    askUser: async (req) => {
      if (!input.isTTY) {
        return "(ask_user unavailable: non-interactive one-shot)";
      }
      const rl = readline.createInterface({ input, output });
      try {
        console.log(`\n[question] ${req.question}`);
        if (req.options?.length) {
          for (let i = 0; i < req.options.length; i++) {
            console.log(`  [${i + 1}] ${req.options[i]}`);
          }
          const answer = (await rl.question("Answer (number or text): ")).trim();
          const n = Number(answer);
          if (
            answer &&
            Number.isInteger(n) &&
            n >= 1 &&
            n <= req.options.length
          ) {
            return req.options[n - 1]!;
          }
          return answer || "(empty)";
        }
        return (await rl.question("Answer: ")).trim() || "(empty)";
      } finally {
        rl.close();
      }
    },
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
