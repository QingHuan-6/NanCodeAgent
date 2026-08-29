import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Create an isolated temp workspace for tool / agent tests. */
export function createTempDir(prefix = "nan-agent-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
