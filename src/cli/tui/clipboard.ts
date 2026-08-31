/**
 * Copy text to the system clipboard (OSC 52 + platform fallback).
 */

import { spawn } from "node:child_process";
import type { CliRenderer } from "@opentui/core";

export async function copyTextToClipboard(
  text: string,
  renderer?: CliRenderer | null,
): Promise<boolean> {
  if (!text) return false;

  let ok = false;
  try {
    if (renderer?.copyToClipboardOSC52?.(text)) {
      ok = true;
    }
  } catch {
    // ignore
  }

  try {
    if (process.platform === "win32") {
      await writeViaPowerShellClipboard(text);
      ok = true;
    } else {
      await writeViaUnixClipboard(text);
      ok = true;
    }
  } catch {
    // keep OSC52 result if any
  }

  return ok;
}

function writeViaPowerShellClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-Command", "Set-Clipboard -Value $input"],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Set-Clipboard exited ${code}`));
    });
    child.stdin.write(text, "utf8");
    child.stdin.end();
  });
}

function writeViaUnixClipboard(text: string): Promise<void> {
  const tryCmd = (cmd: string, args: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${cmd} exited ${code}`));
      });
      child.stdin.write(text, "utf8");
      child.stdin.end();
    });

  return tryCmd("pbcopy", []).catch(() =>
    tryCmd("xclip", ["-selection", "clipboard"]).catch(() =>
      tryCmd("wl-copy", []),
    ),
  );
}
