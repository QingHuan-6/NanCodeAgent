import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  OpenAIToolDefinition,
} from "./types.js";

export interface LlmClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Thin OpenAI-compatible Chat Completions client.
 * Only HTTP + JSON parsing — no agent orchestration.
 */
export class LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: LlmClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
  }

  async chat(
    messages: ChatMessage[],
    tools?: OpenAIToolDefinition[],
  ): Promise<ChatMessage> {
    const body: ChatCompletionRequest = {
      model: this.model,
      messages,
      temperature: 0.2,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM request failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error("LLM response missing choices[0].message");
    }
    return message;
  }
}
