/**
 * OpenTUI on Node needs the experimental `node:ffi` module
 * (Node.js >= 26.4 + `--experimental-ffi`). Bun needs no flag.
 *
 * Re-execs the current process once with the flag when missing.
 */
import { spawnSync } from "node:child_process";

const MIN_MAJOR = 26;
const MIN_MINOR = 4;

export function nodeSupportsOpenTuiFfi(version = process.versions.node): boolean {
  const [majorRaw, minorRaw] = version.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > MIN_MAJOR) return true;
  return major === MIN_MAJOR && minor >= MIN_MINOR;
}

export function isBunRuntime(): boolean {
  return typeof process.versions.bun === "string";
}

export function hasExperimentalFfiFlag(): boolean {
  return process.execArgv.some(
    (arg) => arg === "--experimental-ffi" || arg.startsWith("--experimental-ffi="),
  );
}

/**
 * Ensure OpenTUI can load native FFI. Returns after re-exec (never returns)
 * or returns normally when already OK / Bun.
 */
export function ensureOpenTuiRuntime(): void {
  if (isBunRuntime()) return;
  if (hasExperimentalFfiFlag()) return;

  if (!nodeSupportsOpenTuiFfi()) {
    console.error(
      `[nan-agent] OpenTUI needs Node.js >= ${MIN_MAJOR}.${MIN_MINOR} (with --experimental-ffi) or Bun.`,
    );
    console.error(`[nan-agent] Current: Node ${process.version}`);
    console.error(
      `[nan-agent] Upgrade Node, or use: nan-agent --plain   (readline, no TUI)`,
    );
    process.exit(1);
  }

  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", ...process.execArgv, ...process.argv.slice(1)],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  process.exit(result.status === null ? 1 : result.status);
}
