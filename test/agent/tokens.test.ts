import { describe, expect, it } from "vitest";
import {
  buildContextEstimate,
  estimateContextTokens,
  roughTokenEstimate,
  roughTokensForMessages,
} from "../../src/agent/tokens.js";
import type { ChatMessage, Usage } from "../../src/llm/types.js";
import { Session } from "../../src/session/session.js";

describe("roughTokenEstimate", () => {
  it("uses ~chars/4 for plain text", () => {
    const text = "abcd".repeat(25); // 100 chars
    expect(roughTokenEstimate(text)).toBe(25);
  });

  it("uses denser divisor for JSON-like text", () => {
    const json = `{"a":1,"b":2,"c":[3,4,5],"d":{"e":"f"}}`.repeat(5);
    const plain = "x".repeat(json.length);
    expect(roughTokenEstimate(json)).toBeGreaterThan(roughTokenEstimate(plain));
  });
});

describe("estimateContextTokens with usage anchor", () => {
  it("falls back to full rough when no usage", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hello world" },
      { role: "assistant", content: "hi there" },
    ];
    const { tokens, source } = estimateContextTokens(messages, null, null);
    expect(source).toBe("rough");
    expect(tokens).toBe(roughTokensForMessages(messages));
  });

  it("anchors on last usage and rough-counts after assistant", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: "a", tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "read", arguments: "{}" },
        },
      ]},
      { role: "tool", tool_call_id: "c1", content: "file contents here" },
    ];
    const usage: Usage = {
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
    };
    const { tokens, source } = estimateContextTokens(messages, usage, 1);
    expect(source).toBe("usage+rough");
    const after = roughTokensForMessages([messages[2]!]);
    expect(tokens).toBe(1000 + 50 + after);
  });
});

describe("Session usage anchor", () => {
  it("records and clears usage on replaceMessages", () => {
    const session = new Session({ id: "t-usage" });
    session.append({ role: "user", content: "hi" });
    session.append({ role: "assistant", content: "yo" });
    session.recordUsage(
      { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      1,
    );
    expect(session.getLastUsage()?.prompt_tokens).toBe(10);
    expect(session.getUsageAssistantIndex()).toBe(1);

    session.replaceMessages([
      { role: "system", content: "s" },
      { role: "user", content: "compacted" },
    ]);
    expect(session.getLastUsage()).toBeNull();
    expect(session.getUsageAssistantIndex()).toBeNull();
  });
});

describe("buildContextEstimate", () => {
  it("computes usedRatio against window minus reserve", () => {
    const est = buildContextEstimate(
      [{ role: "user", content: "x".repeat(400) }],
      null,
      null,
      { windowTokens: 1000, outputReserveTokens: 200 },
    );
    expect(est.promptBudgetTokens).toBe(800);
    expect(est.usedRatio).toBeGreaterThan(0);
    expect(est.usedRatio).toBeLessThanOrEqual(1);
  });
});
