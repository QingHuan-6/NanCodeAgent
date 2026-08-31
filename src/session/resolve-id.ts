/**
 * Resolve a user-typed session id to a saved jsonl basename.
 * Accepts full ids (`session-123`) or suffixes (`123`).
 */

import fs from "node:fs";
import path from "node:path";
import { Session } from "../session/session.js";

export function resolveSessionId(
  raw: string,
  persistDir = "sessions",
): string {
  const q = raw.trim();
  if (!q) {
    throw new Error("Empty session id");
  }

  const ids = Session.listSessionIds(persistDir);
  if (ids.length === 0) {
    throw new Error("No saved sessions.");
  }

  if (ids.includes(q)) return q;

  const withPrefix = q.startsWith("session-") ? q : `session-${q}`;
  if (ids.includes(withPrefix)) return withPrefix;

  const matches = ids.filter(
    (id) =>
      id === q ||
      id.endsWith(q) ||
      id.endsWith(`-${q}`) ||
      id.includes(q),
  );

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous id "${q}". Matches:\n${matches.map((m) => `  ${m}`).join("\n")}`,
    );
  }

  // Exact file path fallback
  const direct = path.join(persistDir, `${q}.jsonl`);
  if (fs.existsSync(direct)) return q;
  const prefixed = path.join(persistDir, `${withPrefix}.jsonl`);
  if (fs.existsSync(prefixed)) return withPrefix;

  throw new Error(
    `Session not found: "${q}". Try /sessions (ids may be used without the "session-" prefix).`,
  );
}

/** Short label for lists: strip leading session- when present. */
export function shortSessionId(id: string): string {
  return id.startsWith("session-") ? id.slice("session-".length) : id;
}
