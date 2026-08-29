/**
 * Load config from environment variables.
 * Secrets must never be hardcoded — use .env (gitignored) or the shell env.
 */

export interface Config {
  apiKey: string;
  baseUrl: string;
  model: string;
  workspace: string;
  maxTurns: number;
  temperature: number;
  maxRetries: number;
  timeoutMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and set it.`,
    );
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(cwd = process.cwd()): Config {
  return {
    apiKey: requireEnv("NAN_API_KEY"),
    baseUrl: (
      process.env.NAN_BASE_URL?.trim() || "https://api.openai.com/v1"
    ).replace(/\/$/, ""),
    model: process.env.NAN_MODEL?.trim() || "gpt-4o-mini",
    workspace: process.env.NAN_WORKSPACE?.trim() || cwd,
    maxTurns: intEnv("NAN_MAX_TURNS", 40),
    temperature: Number(process.env.NAN_TEMPERATURE ?? "0.2") || 0.2,
    maxRetries: intEnv("NAN_MAX_RETRIES", 3),
    timeoutMs: intEnv("NAN_TIMEOUT_MS", 120_000),
  };
}
