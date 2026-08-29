import React from "react";
import { render } from "ink";
import type { Config } from "../../config/index.js";
import type { LlmClient } from "../../llm/client.js";
import type { Session } from "../../session/session.js";
import type { ToolRegistry } from "../../tools/registry.js";
import { TuiApp } from "./App.js";

export interface TuiContext {
  config: Config;
  llm: LlmClient;
  tools: ToolRegistry;
  session: Session;
}

/** Interactive Ink TUI — transcript + spinner + composer + diffs. */
export async function runTui(ctx: TuiContext): Promise<void> {
  const instance = render(
    <TuiApp
      config={ctx.config}
      llm={ctx.llm}
      tools={ctx.tools}
      session={ctx.session}
    />,
  );
  await instance.waitUntilExit();
}
