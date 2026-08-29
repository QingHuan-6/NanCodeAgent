import type { ToolDefinition } from "./types.js";

/**
 * Ask the human a clarifying question (OpenCode `question` / Claude AskUserQuestion).
 * Requires askUser on ToolContext — wired by TUI/REPL.
 */
export const askUserTool: ToolDefinition = {
  name: "ask_user",
  description: [
    "Ask the human user a clarifying question before proceeding.",
    "Use when requirements are ambiguous, multiple approaches exist, or a destructive choice needs confirmation.",
    "Prefer multiple-choice options when possible. Do not use for information you can discover with tools.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "Clear question for the user",
      },
      options: {
        type: "array",
        description: "Optional multiple-choice answers (strings)",
        items: { type: "string" },
      },
    },
    required: ["question"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const question =
      typeof args.question === "string" ? args.question.trim() : "";
    if (!question) throw new Error("question is required");

    let options: string[] | undefined;
    if (Array.isArray(args.options)) {
      options = args.options
        .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        .map((o) => o.trim())
        .slice(0, 8);
      if (options.length === 0) options = undefined;
    }

    if (!ctx.askUser) {
      throw new Error(
        "ask_user is unavailable in this UI (no askUser handler). Re-run in TUI or --plain REPL.",
      );
    }

    const answer = await ctx.askUser({ question, options });
    const trimmed = answer.trim();
    if (!trimmed) {
      return { output: "User provided an empty answer." };
    }
    return {
      output: `User answer:\n${trimmed}`,
    };
  },
};
