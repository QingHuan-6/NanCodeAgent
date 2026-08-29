import { truncateOutput } from "./helpers.js";
import type { ToolDefinition } from "./types.js";

const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host === "169.254.169.254" ||
    host === "metadata.google.internal"
  ) {
    throw new Error(`Blocked URL host (SSRF protection): ${host}`);
  }
  return url;
}

export function htmlToText(html: string): string {
  let text = "";
  let skip = 0;
  const re =
    /<\/?(script|style|noscript|iframe|svg|head)[^>]*>|<!--[\s\S]*?-->|<[^>]+>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1]?.toLowerCase();
    if (tag) {
      if (m[0].startsWith("</")) skip = Math.max(0, skip - 1);
      else skip += 1;
      continue;
    }
    if (m[0].startsWith("<") || m[0].startsWith("<!--")) continue;
    if (skip === 0 && m[2]) text += m[2];
  }
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function htmlToMarkdownish(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const t = htmlToText(inner);
    return `\n${"#".repeat(Number(level))} ${t}\n\n`;
  });
  s = s.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const t = htmlToText(inner) || href;
    return `[${t}](${href})`;
  });
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<\/div>/gi, "\n");
  s = s.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "```\n$1\n```\n");
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  return htmlToText(s);
}

/**
 * Fetch a public URL (OpenCode webfetch-inspired; no Turndown dependency).
 */
export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description:
    "Fetch a public http(s) URL and return text or lightweight markdown. Use for docs and references. Blocks private/localhost hosts.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "http(s) URL to fetch" },
      format: {
        type: "string",
        description: "markdown (default) | text | html",
      },
      timeout_sec: {
        type: "number",
        description: "Timeout in seconds (default 30, max 120)",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute(args) {
    const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
    if (!rawUrl) throw new Error("url is required");
    const url = assertSafeUrl(rawUrl);
    const format =
      typeof args.format === "string" ? args.format.toLowerCase() : "markdown";
    if (!["markdown", "text", "html"].includes(format)) {
      throw new Error("format must be markdown|text|html");
    }
    const timeoutSec =
      typeof args.timeout_sec === "number" && Number.isFinite(args.timeout_sec)
        ? Math.min(Math.max(args.timeout_sec, 1), 120)
        : 30;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutSec * 1000);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "NanCodeAgent/0.1 (+local coding agent)",
          Accept:
            format === "html"
              ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"
              : "text/markdown,text/plain,text/html;q=0.8,*/*;q=0.3",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > MAX_BYTES) throw new Error("Response too large");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) throw new Error("Response too large");
      const ctype = res.headers.get("content-type") ?? "";
      const body = buf.toString("utf8");

      let out: string;
      if (format === "html") out = body;
      else if (ctype.includes("text/html")) {
        out = format === "text" ? htmlToText(body) : htmlToMarkdownish(body);
      } else {
        out = body;
      }

      return {
        output: truncateOutput(
          `Fetched ${url}\nContent-Type: ${ctype}\n\n${out}`,
          40_000,
        ),
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * Lightweight web search via DuckDuckGo Instant Answer API (no API key).
 * Prefer web_fetch for full pages when you have a URL.
 */
export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Search the public web (DuckDuckGo Instant Answer). Returns related topics and Abstract. For full page content, follow up with web_fetch on a URL.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) throw new Error("query is required");
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_redirect", "1");
    url.searchParams.set("no_html", "1");

    const res = await fetch(url, {
      headers: { "User-Agent": "NanCodeAgent/0.1" },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
    const data = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: Array<
        | { Text?: string; FirstURL?: string }
        | { Name?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }
      >;
    };

    const lines: string[] = [`Search: ${query}`];
    if (data.Heading) lines.push(`Heading: ${data.Heading}`);
    if (data.AbstractText) {
      lines.push("", data.AbstractText);
      if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
    }

    const topics: Array<{ Text?: string; FirstURL?: string }> = [];
    for (const t of data.RelatedTopics ?? []) {
      if ("Topics" in t && Array.isArray(t.Topics)) {
        topics.push(...t.Topics);
      } else if ("Text" in t) {
        topics.push(t);
      }
    }
    if (topics.length) {
      lines.push("", "Related:");
      for (const t of topics.slice(0, 8)) {
        if (t.Text) {
          lines.push(
            `- ${t.Text}${t.FirstURL ? ` (${t.FirstURL})` : ""}`,
          );
        }
      }
    }
    if (lines.length <= 2) {
      lines.push(
        "",
        "(No instant answer. Try a more specific query, or web_fetch a known docs URL.)",
      );
    }
    return { output: lines.join("\n") };
  },
};
