import fs from "node:fs";
import path from "node:path";
import type { ChatMessage, Usage } from "../llm/types.js";

/**
 * In-memory conversation history with optional JSONL persistence + resume.
 */
export class Session {
  readonly id: string;
  private messages: ChatMessage[] = [];
  private readonly persistDir: string | null;
  private persistEnabled = true;
  /** Last API usage (prompt_tokens anchors context estimate). */
  private lastUsage: Usage | null = null;
  /** Index of the assistant message that produced lastUsage. */
  private usageAssistantIndex: number | null = null;

  constructor(options?: { id?: string; persistDir?: string }) {
    this.id = options?.id ?? `session-${Date.now()}`;
    this.persistDir = options?.persistDir ?? null;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  setMessages(messages: ChatMessage[]): void {
    this.messages = messages;
    this.clampUsageAnchor();
  }

  /** Replace history (e.g. after /compact) and rewrite JSONL when persisting. */
  replaceMessages(messages: ChatMessage[]): void {
    this.messages = messages;
    // History rewrite invalidates usage indices — next estimate is rough until a new call.
    this.clearUsage();
    this.rewritePersistFile();
  }

  append(message: ChatMessage): void {
    this.messages.push(message);
    this.persistLine(message);
  }

  /** Record usage from the LLM call that produced the assistant at assistantIndex. */
  recordUsage(usage: Usage, assistantIndex: number): void {
    this.lastUsage = { ...usage };
    this.usageAssistantIndex = assistantIndex;
  }

  getLastUsage(): Usage | null {
    return this.lastUsage;
  }

  getUsageAssistantIndex(): number | null {
    return this.usageAssistantIndex;
  }

  clearUsage(): void {
    this.lastUsage = null;
    this.usageAssistantIndex = null;
  }

  /** Drop conversation history (used by /clear). */
  clear(): void {
    this.messages = [];
    this.clearUsage();
    this.rewritePersistFile();
  }

  messageCount(): number {
    return this.messages.length;
  }

  filePath(): string | null {
    if (!this.persistDir) return null;
    return path.join(this.persistDir, `${this.id}.jsonl`);
  }

  /**
   * Load messages from a JSONL session file (does not re-append to disk).
   */
  static loadFromJsonl(
    filePath: string,
    options?: { persistDir?: string },
  ): Session {
    const absolute = path.resolve(filePath);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Session file not found: ${absolute}`);
    }
    const id = path.basename(absolute, ".jsonl");
    const persistDir =
      options?.persistDir ?? path.dirname(absolute);
    const session = new Session({ id, persistDir });
    session.persistEnabled = false;
    const raw = fs.readFileSync(absolute, "utf8");
    const messages: ChatMessage[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as { message?: ChatMessage };
        if (row.message && typeof row.message === "object") {
          messages.push(row.message);
        }
      } catch {
        // skip corrupt lines
      }
    }
    session.messages = messages;
    session.persistEnabled = true;
    return session;
  }

  /** List session ids under a directory (newest first). */
  static listSessionIds(persistDir: string): string[] {
    if (!fs.existsSync(persistDir)) return [];
    return fs
      .readdirSync(persistDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        id: f.replace(/\.jsonl$/, ""),
        mtime: fs.statSync(path.join(persistDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.id);
  }

  private clampUsageAnchor(): void {
    if (
      this.usageAssistantIndex != null &&
      this.usageAssistantIndex >= this.messages.length
    ) {
      this.clearUsage();
    }
  }

  private persistLine(message: ChatMessage): void {
    if (!this.persistDir || !this.persistEnabled) return;
    try {
      fs.mkdirSync(this.persistDir, { recursive: true });
      const file = path.join(this.persistDir, `${this.id}.jsonl`);
      fs.appendFileSync(
        file,
        `${JSON.stringify({ ts: Date.now(), message })}\n`,
        "utf8",
      );
    } catch {
      // Persistence must not break the agent loop.
    }
  }

  private rewritePersistFile(): void {
    if (!this.persistDir || !this.persistEnabled) return;
    try {
      fs.mkdirSync(this.persistDir, { recursive: true });
      const file = path.join(this.persistDir, `${this.id}.jsonl`);
      const body = this.messages
        .map((message) => JSON.stringify({ ts: Date.now(), message }))
        .join("\n");
      fs.writeFileSync(file, body ? `${body}\n` : "", "utf8");
    } catch {
      // ignore
    }
  }
}
