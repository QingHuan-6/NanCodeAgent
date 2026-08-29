#!/usr/bin/env node
/**
 * NanCodeAgent CLI entry.
 *
 * Usage:
 *   npm run dev -- "your task here"
 *   npm run dev -- --chat
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgentLoop } from "./agent/index.js";
import { createPrinter } from "./cli/printer.js";
import { loadConfig } from "./config.js";
import { LlmClient } from "./llm/client.js";
import { Session } from "./session/session.js";
import { createDefaultRegistry } from "./tools/index.js";

async function main(): Promise<void> {
  loadDotEnv();

  const args = process.argv.slice(2);
  const chatMode = args.includes("--chat");
  const taskArgs = args.filter((a) => a !== "--chat");

  let task = taskArgs.join(" ").trim();
  if (!task && chatMode) {
    const rl = readline.createInterface({ input, output });
    task = (await rl.question("Task> ")).trim();
    rl.close();
  }

  if (!task) {
    console.log(`NanCodeAgent — scaffold

Usage:
  npm run dev -- "Create a hello.py that prints hi"
  npm run dev -- --chat

Copy .env.example to .env and set NAN_API_KEY before running.
`);
    process.exit(0);
  }

  const config = loadConfig();
  const llm = new LlmClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  const tools = createDefaultRegistry();
  const session = new Session({ persistDir: "sessions" });

  await runAgentLoop(task, {
    llm,
    tools,
    session,
    workspace: config.workspace,
    maxTurns: config.maxTurns,
    onEvent: createPrinter(),
    askPermission: async (reason, toolName) => {
      const rl = readline.createInterface({ input, output });
      const answer = (
        await rl.question(`[ask] Allow ${toolName}? ${reason} [y/N] `)
      )
        .trim()
        .toLowerCase();
      rl.close();
      return answer === "y" || answer === "yes";
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
