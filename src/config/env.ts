import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Per-user config dir (survives using the agent from any folder). */
export function userConfigDir(): string {
  return path.join(os.homedir(), ".nan-agent");
}

export function userEnvPath(): string {
  return path.join(userConfigDir(), ".env");
}

export function projectEnvPath(cwd = process.cwd()): string {
  return path.resolve(cwd, ".env");
}

/** Parse KEY=VALUE lines into a map (no export). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load env files into process.env without overriding already-set shell vars.
 * Merge order: user ~/.nan-agent/.env < project ./.env < existing process.env
 */
export function loadEnvFiles(cwd = process.cwd()): void {
  const merged: Record<string, string> = {};

  const user = userEnvPath();
  const project = projectEnvPath(cwd);

  if (fs.existsSync(user)) {
    Object.assign(merged, parseEnvFile(fs.readFileSync(user, "utf8")));
  }
  if (fs.existsSync(project)) {
    Object.assign(merged, parseEnvFile(fs.readFileSync(project, "utf8")));
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function writeUserEnv(values: Record<string, string>): string {
  const dir = userConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = userEnvPath();

  const existing = fs.existsSync(file)
    ? parseEnvFile(fs.readFileSync(file, "utf8"))
    : {};
  const merged = { ...existing, ...values };

  const lines = [
    "# NanCodeAgent user config — do not commit",
    `# ${file}`,
    "",
  ];
  for (const key of [
    "NAN_API_KEY",
    "NAN_BASE_URL",
    "NAN_MODEL",
    "NAN_MAX_TURNS",
    "NAN_TEMPERATURE",
    "NAN_MAX_RETRIES",
    "NAN_TIMEOUT_MS",
  ]) {
    if (merged[key] !== undefined && merged[key] !== "") {
      lines.push(`${key}=${merged[key]}`);
      delete merged[key];
    }
  }
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "") lines.push(`${key}=${value}`);
  }
  lines.push("");
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

export function hasApiKeyConfigured(): boolean {
  return Boolean(process.env.NAN_API_KEY?.trim());
}
