#!/usr/bin/env node
/**
 * NanCodeAgent CLI entry.
 *
 * Usage:
 *   npm run dev                  # interactive REPL
 *   npm run dev -- "one task"    # one-shot
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgentLoop } from "./agent/index.js";
import { createPrinter } from "./cli/printer.js";
import { runRepl } from "./cli/repl.js";
import { loadConfig } from "./config.js";
import { LlmClient } from "./llm/index.js";
import { Session } from "./session/session.js";
import { createDefaultRegistry } from "./tools/index.js";

async function main(): Promise<void> {
  loadDotEnv();

  const args = process.argv.slice(2).filter((a) => a !== "--chat");
  const oneShot = args.join(" ").trim();

  const config = loadConfig();
  const llm = new LlmClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
  });
  const tools = createDefaultRegistry();
  const session = new Session({ persistDir: "sessions" });

  if (!oneShot) {
    if (!input.isTTY) {
      console.error(
        "Interactive mode needs a TTY. Pass a task for one-shot mode:\n  npm run dev -- \"your task\"",
      );
      process.exit(1);
    }
    await runRepl({ config, llm, tools, session });
    return;
  }

  await runAgentLoop(oneShot, {
    llm,
    tools,
    session,
    workspace: config.workspace,
    maxTurns: config.maxTurns,
    onEvent: createPrinter(),
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
  });
}

/** Minimal .env loader (no dependency). Does not override existing env. */
function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
