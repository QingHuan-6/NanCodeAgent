/**
 * Pi-style pending message queue for steering / follow-up.
 */

export type QueueMode = "all" | "one-at-a-time";

export class PendingMessageQueue<T> {
  private messages: T[] = [];
  mode: QueueMode;

  constructor(mode: QueueMode = "one-at-a-time") {
    this.mode = mode;
  }

  enqueue(message: T): void {
    this.messages.push(message);
  }

  hasItems(): boolean {
    return this.messages.length > 0;
  }

  /** Drain according to mode (all vs first only). */
  drain(): T[] {
    if (this.mode === "all") {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }
    const first = this.messages[0];
    if (!first) return [];
    this.messages = this.messages.slice(1);
    return [first];
  }

  clear(): void {
    this.messages = [];
  }

  size(): number {
    return this.messages.length;
  }
}
