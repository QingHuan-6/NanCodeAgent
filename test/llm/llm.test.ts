import { describe, expect, it } from "vitest";
import {
  buildChatCompletionBody,
  isReasoningModel,
  normalizeMessagesForApi,
} from "../../src/llm/message.js";
import { SseParser } from "../../src/llm/sse.js";
import { classifyHttpError, parseRetryAfterMs } from "../../src/llm/errors.js";
import { collectChatStream, iterateChatStream } from "../../src/llm/stream.js";

describe("llm/message", () => {
  it("drops empty tool_calls on assistant messages", () => {
    const normalized = normalizeMessagesForApi([
      { role: "assistant", content: "hi", tool_calls: [] },
      { role: "tool", content: "ok", tool_call_id: "1" },
    ]);
    expect(normalized[0].tool_calls).toBeUndefined();
    expect(normalized[1]).toMatchObject({
      role: "tool",
      tool_call_id: "1",
      content: "ok",
    });
  });

  it("skips temperature for reasoning-like models", () => {
    expect(isReasoningModel("o3-mini")).toBe(true);
    const body = buildChatCompletionBody({
      model: "o3-mini",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.9,
    });
    expect(body.temperature).toBeUndefined();
  });

  it("includes tools and temperature for normal models", () => {
    const body = buildChatCompletionBody({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      tools: [
        {
          type: "function",
          function: {
            name: "bash",
            description: "run",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });
    expect(body.temperature).toBe(0.2);
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
  });
});

describe("llm/errors", () => {
  it("classifies 429 as retryable rate_limit", () => {
    const err = classifyHttpError(429, "slow down");
    expect(err.code).toBe("rate_limit");
    expect(err.retryable).toBe(true);
  });

  it("classifies context length errors", () => {
    const err = classifyHttpError(400, "maximum context length exceeded");
    expect(err.code).toBe("context_length");
    expect(err.retryable).toBe(false);
  });

  it("parses Retry-After seconds", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
  });
});

describe("llm/sse + stream", () => {
  it("parses SSE frames across chunk boundaries", () => {
    const parser = new SseParser();
    expect(parser.push("data: {\"a\":1")).toEqual([]);
    const frames = parser.push("}\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0].data).toBe('{"a":1}');
  });

  it("accumulates streamed text and tool calls", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      `data: ${JSON.stringify({
        id: "1",
        choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: "1",
        choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: "1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "bash", arguments: "{\"c" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: "1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: "md\":\"x\"}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })}\n\n`,
      "data: [DONE]\n\n",
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });

    const result = await collectChatStream(iterateChatStream(stream));
    expect(result.message.content).toBe("Hello");
    expect(result.message.tool_calls?.[0].function.name).toBe("bash");
    expect(result.message.tool_calls?.[0].function.arguments).toBe(
      '{"cmd":"x"}',
    );
    expect(result.finishReason).toBe("tool_calls");
  });
});
