import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentRuntime, formatContextBreakdown, formatContextLine } from "../agent/index.js";
import type { AgentLoopOptions } from "../agent/types.js";
import { loadConfig, type Config } from "../config/index.js";
import { LlmClient } from "../llm/client.js";
import { Session } from "../session/session.js";
import type { ToolRegistry } from "../tools/registry.js";
import { createPrinter } from "./printer.js";
import { runSetupWizard } from "./setup.js";
import { helpText, parseSlashCommand, type SlashAction } from "./slash.js";
import {
  applyMemorySlash,
  parseMemorySlashArg,
} from "../memory/index.js";
import { resolveSessionId, shortSessionId } from "../session/resolve-id.js";
import { applyWebSlash, parseWebSlashArg } from "./web-slash.js";

export interface ReplContext {
  config: Config;
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
}

/**
 * Classic readline REPL with AgentRuntime (continue/compact/resume).
 * Mid-run steer is TUI-only (readline blocks).
 */
export async function runRepl(ctx: ReplContext): Promise<void> {
  printBanner(ctx);

  const rl = readline.createInterface({ input, output, terminal: true });
  const askPermission = createAskPermission(rl);
  const askUser = createAskUser(rl);
  const printer = createPrinter({ compact: true });

  const runtime = new AgentRuntime({
    config: ctx.config,
    llm: ctx.llm,
    tools: ctx.tools,
    session: ctx.session,
    onEvent: printer,
    askPermission,
    askUser,
  });

  try {
    while (true) {
      let line: string;
      try {
        line = await rl.question("› ");
      } catch {
        break;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      const slash = parseSlashCommand(trimmed);
      if (slash) {
        const shouldExit = await handleSlash(slash, ctx, rl, runtime);
        if (shouldExit) break;
        // Keep runtime bound to possibly replaced session/config
        runtime.config = ctx.config;
        runtime.llm = ctx.llm;
        runtime.session = ctx.session;
        continue;
      }

      try {
        await runtime.prompt(trimmed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[error] ${message}`);
      }
    }
  } finally {
    rl.close();
    console.log("Bye.");
  }
}

function createAskPermission(
  rl: readline.Interface,
): NonNullable<AgentLoopOptions["askPermission"]> {
  return async (reason, toolName) => {
    const answer = (
      await rl.question(`[ask] Allow ${toolName}? ${reason} [y/N] `)
    )
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  };
}

function createAskUser(
  rl: readline.Interface,
): NonNullable<AgentLoopOptions["askUser"]> {
  return async (req) => {
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
    const answer = (await rl.question("Answer: ")).trim();
    return answer || "(empty)";
  };
}

async function handleSlash(
  slash: SlashAction,
  ctx: ReplContext,
  rl: readline.Interface,
  runtime: AgentRuntime,
): Promise<boolean> {
  switch (slash.type) {
    case "exit":
      return true;
    case "help":
      console.log(helpText());
      return false;
    case "clear":
      ctx.session.clear();
      console.log("Session cleared.");
      return false;
    case "status":
      console.log(
        [
          `session:   ${ctx.session.id}`,
          `messages:  ${ctx.session.messageCount()}`,
          `mode:      ${runtime.mode}`,
          `model:     ${ctx.config.model}`,
          `base_url:  ${ctx.config.baseUrl}`,
          `workspace: ${ctx.config.workspace}`,
          `max_turns: ${ctx.config.maxTurns}`,
          `context:   ${formatContextLine(runtime.getContextEstimate())}`,
        ].join("\n"),
      );
      return false;
    case "context":
      console.log(
        formatContextBreakdown(
          runtime.getContextEstimate(),
          ctx.session.getMessages(),
        ),
      );
      return false;
    case "memory": {
      const parsed = parseMemorySlashArg(slash.arg ?? "");
      if (parsed.kind === "error") {
        console.log(parsed.message);
        return false;
      }
      console.log(applyMemorySlash(ctx.config.workspace, parsed));
      if (parsed.kind !== "status") {
        runtime.refreshSystemPrompt();
      }
      return false;
    }
    case "web": {
      const parsed = parseWebSlashArg(slash.arg ?? "");
      if (parsed.kind === "error") {
        console.log(parsed.message);
        return false;
      }
      console.log(applyWebSlash(ctx.config.workspace, parsed));
      if (parsed.kind !== "status") {
        try {
          runtime.refreshTools();
          ctx.tools = runtime.tools;
        } catch (err) {
          console.error(`[error] ${err instanceof Error ? err.message : err}`);
        }
      }
      return false;
    }
    case "setup": {
      await runSetupWizard({ rl });
      ctx.config = loadConfig(ctx.config.workspace);
      ctx.llm = new LlmClient({
        apiKey: ctx.config.apiKey,
        baseUrl: ctx.config.baseUrl,
        model: ctx.config.model,
        temperature: ctx.config.temperature,
        maxRetries: ctx.config.maxRetries,
        timeoutMs: ctx.config.timeoutMs,
      });
      runtime.config = ctx.config;
      runtime.llm = ctx.llm;
      console.log(`Using model ${ctx.config.model} @ ${ctx.config.baseUrl}`);
      return false;
    }
    case "continue":
      try {
        await runtime.continue();
      } catch (err) {
        console.error(`[error] ${err instanceof Error ? err.message : err}`);
      }
      return false;
    case "compact": {
      const result = await runtime.compact({
        customInstructions: slash.instructions,
      });
      const detail =
        result.mode === "llm"
          ? `LLM summary (${result.summaryChars} chars), removed ~${result.removed} messages`
          : result.mode === "prune"
            ? `Pruned ~${result.removed} messages (summarizer fallback)`
            : "Nothing to compact";
      console.log(`Compacted — ${detail}.`);
      return false;
    }
    case "plan":
      try {
        runtime.setMode("plan");
        ctx.tools = runtime.tools;
        console.log(
          "Plan mode: read/glob/grep/todo/ask/web/lsp/skill (no writes).",
        );
      } catch (err) {
        console.error(`[error] ${err instanceof Error ? err.message : err}`);
      }
      return false;
    case "agent":
      try {
        runtime.setMode("agent");
        ctx.tools = runtime.tools;
        console.log("Agent mode: full tools enabled.");
      } catch (err) {
        console.error(`[error] ${err instanceof Error ? err.message : err}`);
      }
      return false;
    case "sessions": {
      const ids = Session.listSessionIds("sessions");
      console.log(
        ids.length === 0
          ? "No saved sessions."
          : ids
              .map((id) => `  ${shortSessionId(id)}  (${id})`)
              .join("\n"),
      );
      return false;
    }
    case "resume": {
      if (!slash.id) {
        console.log("Usage: /resume <id>  (full or suffix; see /sessions)");
        return false;
      }
      try {
        const resolved = resolveSessionId(slash.id, "sessions");
        ctx.session = Session.loadFromJsonl(`sessions/${resolved}.jsonl`, {
          persistDir: "sessions",
        });
        runtime.session = ctx.session;
        console.log(
          `Loaded ${ctx.session.id} (${ctx.session.messageCount()} messages). Use /continue to resume.`,
        );
      } catch (err) {
        console.error(`[error] ${err instanceof Error ? err.message : err}`);
      }
      return false;
    }
    case "unknown":
      console.log(`Unknown command: /${slash.name}. Type /help for commands.`);
      return false;
    default:
      return false;
  }
}

function printBanner(ctx: ReplContext): void {
  console.log(
    [
      "",
      "NanCodeAgent — plain REPL",
      `model: ${ctx.config.model}`,
      `workspace: ${ctx.config.workspace}`,
      "Type a task, or /help. /exit to quit.",
      "",
    ].join("\n"),
  );
}
