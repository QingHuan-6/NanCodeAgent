import {
  runLspOperation,
  type LspOperation,
} from "../lsp/client.js";
import {
  requireString,
  optionalNumber,
  resolveWorkspacePath,
} from "./helpers.js";
import type { ToolDefinition } from "./types.js";

const OPS = new Set<LspOperation>([
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
]);

/**
 * Language Server Protocol queries (OpenCode-style operations).
 * Spawns typescript-language-server / pyright via npx when needed.
 */
export const lspTool: ToolDefinition = {
  name: "lsp",
  description: [
    "Query a Language Server for code intelligence.",
    "Operations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation.",
    "line/character are 1-based (editor coordinates).",
    "Supported files: TypeScript/JavaScript (.ts/.tsx/.js/.jsx) and Python (.py).",
    "TS/JS uses typescript-language-server; Python uses pyright (npx -p pyright pyright-langserver).",
    "First use may download via npx (needs network); failures include stderr in the tool error.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description:
          "goToDefinition | findReferences | hover | documentSymbol | workspaceSymbol | goToImplementation",
      },
      path: {
        type: "string",
        description: "File path (used to pick/start the LSP server)",
      },
      line: {
        type: "number",
        description: "1-based line (required except workspaceSymbol)",
      },
      character: {
        type: "number",
        description: "1-based character/column (required except workspaceSymbol/documentSymbol)",
      },
      query: {
        type: "string",
        description: "Symbol query for workspaceSymbol",
      },
    },
    required: ["operation", "path"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const operation = requireString(args, "operation") as LspOperation;
    if (!OPS.has(operation)) {
      throw new Error(
        `Invalid operation. Use: ${[...OPS].join(", ")}`,
      );
    }
    const filePath = requireString(args, "path");
    const absolute = resolveWorkspacePath(ctx, filePath);
    const line = optionalNumber(args, "line");
    const character = optionalNumber(args, "character");
    const query = typeof args.query === "string" ? args.query : undefined;

    if (
      operation !== "workspaceSymbol" &&
      operation !== "documentSymbol" &&
      (line == null || character == null)
    ) {
      throw new Error("line and character are required for this operation");
    }

    const output = await runLspOperation({
      workspace: ctx.workspace,
      operation,
      filePath: absolute,
      line: line ?? 1,
      character: character ?? 1,
      query,
    });

    return {
      output: `lsp ${operation} ${filePath}${
        line != null ? `:${line}:${character}` : ""
      }\n${output}`,
    };
  },
};
