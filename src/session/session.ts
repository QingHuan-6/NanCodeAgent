import fs from "node:fs";
import path from "node:path";
import type { ChatMessage } from "../llm/types.js";

/**
 * In-memory conversation history with optional JSONL persistence.
 */
export class Session {
  readonly id: string;
  private messages: ChatMessage[] = [];
  private readonly persistDir: string | null;

  constructor(options?: { id?: string; persistDir?: string }) {
    this.id = options?.id ?? `session-${Date.now()}`;
    this.persistDir = options?.persistDir ?? null;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  setMessages(messages: ChatMessage[]): void {
    this.messages = messages;
  }

  append(message: ChatMessage): void {
    this.messages.push(message);
    this.persistLine(message);
  }

  /** Optional: append one JSONL record (Phase 2 can harden resume/load). */
  private persistLine(message: ChatMessage): void {
    if (!this.persistDir) return;
    try {
      fs.mkdirSync(this.persistDir, { recursive: true });
      const file = path.join(this.persistDir, `${this.id}.jsonl`);
      fs.appendFileSync(file, `${JSON.stringify({ ts: Date.now(), message })}\n`, "utf8");
    } catch {
      // Persistence must not break the agent loop in the scaffold stage.
    }
  }
}
