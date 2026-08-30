/**
 * OpenCode-style HTTP skill catalogs:
 *   GET {base}/index.json
 *   GET {base}/{name}/{file} for each listed file
 * Cached under ~/.nan-agent/skills-cache/<id>/
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { userConfigDir } from "../config/env.js";
import { assertSafeUrl } from "../tools/web.js";

const MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CatalogSkillEntry {
  name: string;
  version: string;
  files: string[];
}

export interface CatalogIndex {
  skills: CatalogSkillEntry[];
}

export interface CatalogMeta {
  url: string;
  pulledAt: string;
  skills: Record<string, string>;
}

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export function skillsCacheRoot(): string {
  return path.join(userConfigDir(), "skills-cache");
}

export function catalogCacheDir(baseUrl: string): string {
  const id = createHash("sha256")
    .update(normalizeBaseUrl(baseUrl))
    .digest("hex")
    .slice(0, 16);
  return path.join(skillsCacheRoot(), id);
}

/**
 * Pull (or refresh) one HTTP catalog into the local cache.
 * Returns the cache directory (scan this as a skill source root).
 */
export async function pullHttpCatalog(
  baseUrl: string,
  options?: { fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<{ cacheDir: string; updated: boolean; skillCount: number }> {
  const base = normalizeBaseUrl(baseUrl);
  assertSafeUrl(base);
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheDir = catalogCacheDir(base);
  fs.mkdirSync(cacheDir, { recursive: true });

  const indexUrl = new URL("index.json", base).href;
  const index = await fetchJson<CatalogIndex>(fetchImpl, indexUrl, timeoutMs);
  if (!index || !Array.isArray(index.skills)) {
    throw new Error(`Invalid skill catalog index at ${indexUrl}`);
  }

  const metaPath = path.join(cacheDir, ".catalog-meta.json");
  let prev: CatalogMeta | null = null;
  try {
    if (fs.existsSync(metaPath)) {
      prev = JSON.parse(fs.readFileSync(metaPath, "utf8")) as CatalogMeta;
    }
  } catch {
    prev = null;
  }

  let updated = false;
  const nextSkills: Record<string, string> = {};

  for (const entry of index.skills) {
    const name = sanitizeSkillName(entry?.name);
    if (!name) continue;
    const version = String(entry.version ?? "").trim() || "0";
    const files = Array.isArray(entry.files)
      ? entry.files.filter((f): f is string => typeof f === "string")
      : [];
    if (files.length === 0) {
      throw new Error(`Catalog skill "${name}" has no files`);
    }
    nextSkills[name] = version;
    const skillDir = path.join(cacheDir, name);
    if (prev?.skills?.[name] === version && dirLooksPopulated(skillDir)) {
      continue;
    }
    await downloadSkillFiles(fetchImpl, base, name, files, skillDir, timeoutMs);
    updated = true;
  }

  const meta: CatalogMeta = {
    url: base,
    pulledAt: new Date().toISOString(),
    skills: nextSkills,
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  return { cacheDir, updated, skillCount: Object.keys(nextSkills).length };
}

function normalizeBaseUrl(raw: string): string {
  const u = new URL(raw);
  if (!u.pathname.endsWith("/")) u.pathname = `${u.pathname}/`;
  return u.href;
}

function sanitizeSkillName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(n)) return null;
  if (n.includes("..") || n.includes("/") || n.includes("\\")) return null;
  return n.toLowerCase();
}

function safeRelFile(file: string): string | null {
  const normalized = file.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  if (path.isAbsolute(normalized)) return null;
  return normalized;
}

function dirLooksPopulated(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some((n) => !n.startsWith("."));
  } catch {
    return false;
  }
}

async function downloadSkillFiles(
  fetchImpl: FetchLike,
  base: string,
  name: string,
  files: string[],
  skillDir: string,
  timeoutMs: number,
): Promise<void> {
  fs.mkdirSync(skillDir, { recursive: true });
  const skillBase = new URL(`${name}/`, base).href;

  for (const file of files) {
    const rel = safeRelFile(file);
    if (!rel) throw new Error(`Unsafe catalog file path: ${file}`);
    const url = new URL(rel, skillBase);
    if (url.origin !== new URL(base).origin) {
      throw new Error(`Catalog file must be same-origin: ${rel}`);
    }
    const body = await fetchBytes(fetchImpl, url.href, timeoutMs);
    const dest = path.join(skillDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
}

async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<T> {
  const text = (await fetchBytes(fetchImpl, url, timeoutMs)).toString("utf8");
  return JSON.parse(text) as T;
}

async function fetchBytes(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<Buffer> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ac.signal,
      headers: { "User-Agent": "NanCodeAgent/0.1 (+skills-catalog)" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_FILE_BYTES) {
      throw new Error(`Catalog file too large: ${url}`);
    }
    return buf;
  } finally {
    clearTimeout(timer);
  }
}
