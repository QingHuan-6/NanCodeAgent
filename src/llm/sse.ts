/**
 * Minimal SSE frame parser for OpenAI-compatible chat streams.
 */

export interface SseFrame {
  event?: string;
  data: string;
}

export class SseParser {
  private buffer = "";

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];

    while (true) {
      const normalized = this.buffer.replace(/\r\n/g, "\n");
      const idx = normalized.indexOf("\n\n");
      if (idx < 0) {
        this.buffer = normalized;
        break;
      }
      const raw = normalized.slice(0, idx);
      this.buffer = normalized.slice(idx + 2);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }

    return frames;
  }

  finish(): SseFrame[] {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const frame = parseFrame(this.buffer.replace(/\r\n/g, "\n"));
    this.buffer = "";
    return frame ? [frame] : [];
  }
}

function parseFrame(raw: string): SseFrame | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of trimmed.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
