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

export function loadConfig(cwd = process.cwd()): Config {
  return {
    apiKey: requireEnv("NAN_API_KEY"),
    baseUrl: (process.env.NAN_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    ),
    model: process.env.NAN_MODEL?.trim() || "gpt-4o-mini",
    workspace: process.env.NAN_WORKSPACE?.trim() || cwd,
    maxTurns: Number(process.env.NAN_MAX_TURNS ?? "40") || 40,
  };
}
