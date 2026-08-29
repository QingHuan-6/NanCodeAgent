import type { OpenAIToolDefinition } from "../llm/types.js";
import {
  toOpenAITool,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "./types.js";
import { spillToolOutputIfNeeded } from "./spill.js";

/**
 * Registers tools and exposes OpenAI-compatible schemas + local execution.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  toOpenAITools(): OpenAIToolDefinition[] {
    return this.list().map(toOpenAITool);
  }

  async run(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { output: `Unknown tool: ${name}` };
    }
    try {
      const result = await tool.execute(args, ctx);
      return {
        ...result,
        output: spillToolOutputIfNeeded(result.output, ctx, name),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Tool "${name}" failed: ${message}` };
    }
  }
}
