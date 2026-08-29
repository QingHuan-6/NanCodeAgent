import type { ParsedToolCall } from "./types.js";

/**
 * Detect repeated identical tool calls (OpenCode "doom loop" idea).
 * Threshold consecutive matches → stop.
 */
export class DoomLoopGuard {
  private lastSignature = "";
  private streak = 0;
  private readonly threshold: number;

  constructor(threshold = 3) {
    this.threshold = Math.max(2, threshold);
  }

  /** Returns true if the loop should abort after recording this call. */
  observe(call: ParsedToolCall): boolean {
    if (call.signature === this.lastSignature) {
      this.streak += 1;
    } else {
      this.lastSignature = call.signature;
      this.streak = 1;
    }
    return this.streak >= this.threshold;
  }

  reset(): void {
    this.lastSignature = "";
    this.streak = 0;
  }
}
