import type { SkillInfo } from "./types.js";
import { SKILL_NAME_RE } from "./types.js";

export interface ParsedSkillMarkdown {
  data: Record<string, unknown>;
  content: string;
}

/**
 * Minimal YAML frontmatter parser (name/description/flags only).
 * Avoids a gray-matter dependency for the harness.
 */
export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---")) {
    return { data: {}, content: text.trim() };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) {
    return { data: {}, content: text.trim() };
  }
  const matter = text.slice(3, end).trim();
  let body = text.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);

  const data: Record<string, unknown> = {};
  const lines = matter.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();

    // Folded / literal block scalars: description: >-  or |
    if (value === ">" || value === ">-" || value === "|" || value === "|-") {
      const parts: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        if (/^\s+\S/.test(next) || next.trim() === "") {
          i += 1;
          if (next.trim()) parts.push(next.trim());
          continue;
        }
        break;
      }
      data[key] = parts.join(" ").trim();
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "true") data[key] = true;
    else if (value === "false") data[key] = false;
    else data[key] = value;
  }

  return { data, content: body.trim() };
}

export function skillInfoFromParsed(
  location: string,
  directory: string,
  parsed: ParsedSkillMarkdown,
  fallbackName?: string,
): SkillInfo | null {
  const nameRaw =
    typeof parsed.data.name === "string"
      ? parsed.data.name.trim()
      : (fallbackName?.trim() ?? "");
  const descriptionRaw =
    typeof parsed.data.description === "string"
      ? parsed.data.description.trim()
      : fallbackName
        ? `Skill ${fallbackName}`
        : "";
  if (!nameRaw || !descriptionRaw) return null;
  if (!SKILL_NAME_RE.test(nameRaw)) return null;

  const disable =
    parsed.data["disable-model-invocation"] === true ||
    parsed.data.disableModelInvocation === true;

  return {
    name: nameRaw,
    description: descriptionRaw,
    location,
    directory,
    disableModelInvocation: disable,
  };
}
