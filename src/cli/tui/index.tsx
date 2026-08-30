import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
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

/**
 * Interactive TUI on OpenTUI (same toolkit OpenCode uses):
 * sticky ScrollBox transcript + composer chrome.
 */
export async function runTui(ctx: TuiContext): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
  });

  const root = createRoot(renderer);

  await new Promise<void>((resolve) => {
    const finish = () => {
      try {
        root.unmount();
      } catch {
        // ignore
      }
      try {
        renderer.destroy();
      } catch {
        // ignore
      }
      resolve();
    };

    renderer.once("destroy", () => resolve());

    root.render(
      <TuiApp
        config={ctx.config}
        llm={ctx.llm}
        tools={ctx.tools}
        session={ctx.session}
        onExit={finish}
      />,
    );
  });
}
