/**
 * Load runtime config after env files / setup wizard have run.
 */

import { hasApiKeyConfigured } from "./env.js";

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

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(cwd = process.cwd()): Config {
  if (!hasApiKeyConfigured()) {
    throw new Error(
      "NAN_API_KEY is not set. Run the app in a terminal to finish setup, or set NAN_API_KEY.",
    );
  }

  return {
    apiKey: process.env.NAN_API_KEY!.trim(),
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

export {
  hasApiKeyConfigured,
  loadEnvFiles,
  userConfigDir,
  userEnvPath,
  writeUserEnv,
} from "./env.js";
