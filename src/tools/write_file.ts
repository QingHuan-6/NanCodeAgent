import fs from "node:fs";
import path from "node:path";
import {
  MAX_WRITE_BYTES,
  requireString,
  resolveWorkspacePath,
} from "./helpers.js";
import type { ToolDefinition } from "./types.js";

/** Create or overwrite a text file under the workspace. */
export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "Write full contents to a file under the workspace (creates parent directories). Prefer edit_file for small changes.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to workspace or absolute within workspace",
      },
      content: {
        type: "string",
        description: "Full file contents to write",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const filePath = requireString(args, "path");
    const content = requireString(args, "content");

    if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
      throw new Error(
        `Content too large (${Buffer.byteLength(content, "utf8")} bytes, max ${MAX_WRITE_BYTES})`,
      );
    }

    const absolute = resolveWorkspacePath(ctx, filePath);
    const existed = fs.existsSync(absolute);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");

    const bytes = Buffer.byteLength(content, "utf8");
    return {
      output: [
        existed ? "updated" : "created",
        `path: ${absolute}`,
        `bytes: ${bytes}`,
      ].join("\n"),
    };
  },
};
