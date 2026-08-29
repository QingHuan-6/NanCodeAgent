/**
 * Minimal LSP JSON-RPC client over stdio (OpenCode-style ops, local spawn).
 * Starts typescript-language-server / pyright when available on PATH or via npx.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type LspOperation =
  | "goToDefinition"
  | "findReferences"
  | "hover"
  | "documentSymbol"
  | "workspaceSymbol"
  | "goToImplementation";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface ManagedClient {
  languageId: string;
  rootUri: string;
  proc: ChildProcessWithoutNullStreams;
  nextId: number;
  pending: Map<number, Pending>;
  buffer: Buffer;
  ready: Promise<void>;
  openFiles: Set<string>;
}

const clients = new Map<string, ManagedClient>();

function languageIdFor(file: string): string | null {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    default:
      return null;
  }
}

function serverCommand(
  languageId: string,
): { command: string; args: string[] } | null {
  // With shell:true on Windows, use bare `npx` (cmd resolves the .cmd shim).
  const npx = "npx";
  if (languageId === "typescript" || languageId === "javascript") {
    return {
      command: npx,
      args: ["--yes", "typescript-language-server", "--stdio"],
    };
  }
  if (languageId === "python") {
    // Binary `pyright-langserver` ships inside the `pyright` package (not a separate npm name).
    return {
      command: npx,
      args: ["--yes", "-p", "pyright", "pyright-langserver", "--stdio"],
    };
  }
  return null;
}

function clientKey(workspace: string, languageId: string): string {
  return `${path.resolve(workspace)}::${languageId}`;
}

function writeMessage(proc: ChildProcessWithoutNullStreams, msg: object): void {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.from(
    `Content-Length: ${body.length}\r\n\r\n`,
    "utf8",
  );
  proc.stdin.write(Buffer.concat([header, body]));
}

function feed(
  client: ManagedClient,
  chunk: Buffer,
): void {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (true) {
    const headerEnd = client.buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = client.buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      client.buffer = client.buffer.subarray(headerEnd + 4);
      continue;
    }
    const len = Number(match[1]);
    const start = headerEnd + 4;
    if (client.buffer.length < start + len) return;
    const json = client.buffer.subarray(start, start + len).toString("utf8");
    client.buffer = client.buffer.subarray(start + len);
    try {
      const msg = JSON.parse(json) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
        method?: string;
      };
      if (msg.id != null && client.pending.has(msg.id)) {
        const p = client.pending.get(msg.id)!;
        client.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message ?? "LSP error"));
        } else {
          p.resolve(msg.result);
        }
      }
      // notifications ignored
    } catch {
      // skip bad frame
    }
  }
}

async function request(
  client: ManagedClient,
  method: string,
  params: unknown,
): Promise<unknown> {
  await client.ready;
  const id = client.nextId++;
  return new Promise((resolve, reject) => {
    client.pending.set(id, { resolve, reject });
    writeMessage(client.proc, { jsonrpc: "2.0", id, method, params });
    setTimeout(() => {
      if (client.pending.has(id)) {
        client.pending.delete(id);
        reject(new Error(`LSP timeout: ${method}`));
      }
    }, 20_000);
  });
}

async function ensureClient(
  workspace: string,
  languageId: string,
): Promise<ManagedClient> {
  const key = clientKey(workspace, languageId);
  const existing = clients.get(key);
  if (existing) return existing;

  const cmd = serverCommand(languageId);
  if (!cmd) throw new Error(`No LSP server mapping for ${languageId}`);

  const proc = spawn(cmd.command, cmd.args, {
    cwd: workspace,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    shell: process.platform === "win32",
    windowsHide: true,
  });

  const rootUri = pathToFileURL(path.resolve(workspace)).href;
  let stderrBuf = "";
  const client: ManagedClient = {
    languageId,
    rootUri,
    proc,
    nextId: 1,
    pending: new Map(),
    buffer: Buffer.alloc(0),
    openFiles: new Set(),
    ready: Promise.resolve(),
  };

  proc.stdout.on("data", (c: Buffer) => feed(client, c));
  proc.stderr.on("data", (c: Buffer) => {
    stderrBuf += c.toString("utf8");
    if (stderrBuf.length > 4_000) {
      stderrBuf = stderrBuf.slice(-4_000);
    }
  });
  proc.on("error", (err) => {
    clients.delete(key);
    const msg = `Failed to start LSP (${cmd.command} ${cmd.args.join(" ")}): ${err.message}`;
    for (const [, p] of client.pending) {
      p.reject(new Error(msg));
    }
    client.pending.clear();
  });
  proc.on("exit", (code, signal) => {
    clients.delete(key);
    const tail = stderrBuf.trim();
    const detail = [
      `LSP server exited (code=${code ?? "?"}, signal=${signal ?? "none"})`,
      `cmd: ${cmd.command} ${cmd.args.join(" ")}`,
      tail ? `stderr:\n${tail}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    for (const [, p] of client.pending) {
      p.reject(new Error(detail));
    }
    client.pending.clear();
  });

  clients.set(key, client);

  // Do not await client.ready inside initialize (would deadlock).
  client.ready = (async () => {
    const id = client.nextId++;
    const initResult = await new Promise<unknown>((resolve, reject) => {
      client.pending.set(id, { resolve, reject });
      writeMessage(client.proc, {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          processId: process.pid,
          rootUri,
          capabilities: {
            textDocument: {
              hover: { contentFormat: ["markdown", "plaintext"] },
              definition: { linkSupport: true },
              references: {},
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
              implementation: {},
            },
            workspace: { symbol: {} },
          },
          workspaceFolders: [{ uri: rootUri, name: path.basename(workspace) }],
        },
      });
      setTimeout(() => {
        if (client.pending.has(id)) {
          client.pending.delete(id);
          const tail = stderrBuf.trim();
          reject(
            new Error(
              `LSP timeout: initialize${tail ? `\nstderr:\n${tail}` : ""}`,
            ),
          );
        }
      }, 60_000);
    });
    void initResult;
    writeMessage(client.proc, {
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    });
  })();

  await client.ready;
  return client;
}

async function didOpen(
  client: ManagedClient,
  absolute: string,
  languageId: string,
): Promise<void> {
  const uri = pathToFileURL(absolute).href;
  if (client.openFiles.has(uri)) {
    // refresh
    const text = fs.readFileSync(absolute, "utf8");
    writeMessage(client.proc, {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri, version: Date.now() },
        contentChanges: [{ text }],
      },
    });
    return;
  }
  const text = fs.readFileSync(absolute, "utf8");
  writeMessage(client.proc, {
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text,
      },
    },
  });
  client.openFiles.add(uri);
  // give server a moment to analyze
  await new Promise((r) => setTimeout(r, 150));
}

function formatResult(op: LspOperation, result: unknown): string {
  if (result == null) return `(no ${op} results)`;
  const text = JSON.stringify(result, null, 2);
  if (text.length > 24_000) {
    return `${text.slice(0, 24_000)}\n…[truncated]`;
  }
  return text;
}

export async function runLspOperation(options: {
  workspace: string;
  operation: LspOperation;
  filePath: string;
  line?: number;
  character?: number;
  query?: string;
}): Promise<string> {
  const absolute = path.isAbsolute(options.filePath)
    ? options.filePath
    : path.resolve(options.workspace, options.filePath);

  if (!fs.existsSync(absolute)) {
    throw new Error(`File not found: ${options.filePath}`);
  }

  const languageId = languageIdFor(absolute);
  if (!languageId) {
    throw new Error(
      `No LSP server for this file type (${path.extname(absolute)}). Supported: .ts/.tsx/.js/.jsx/.py`,
    );
  }

  const client = await ensureClient(options.workspace, languageId);
  await didOpen(client, absolute, languageId);

  const uri = pathToFileURL(absolute).href;
  const line = (options.line ?? 1) - 1;
  const character = (options.character ?? 1) - 1;
  const position = { line, character };

  let result: unknown;
  switch (options.operation) {
    case "hover":
      result = await request(client, "textDocument/hover", {
        textDocument: { uri },
        position,
      });
      break;
    case "goToDefinition":
      result = await request(client, "textDocument/definition", {
        textDocument: { uri },
        position,
      });
      break;
    case "findReferences":
      result = await request(client, "textDocument/references", {
        textDocument: { uri },
        position,
        context: { includeDeclaration: true },
      });
      break;
    case "goToImplementation":
      result = await request(client, "textDocument/implementation", {
        textDocument: { uri },
        position,
      });
      break;
    case "documentSymbol":
      result = await request(client, "textDocument/documentSymbol", {
        textDocument: { uri },
      });
      break;
    case "workspaceSymbol":
      result = await request(client, "workspace/symbol", {
        query: options.query ?? "",
      });
      break;
    default:
      throw new Error(`Unsupported LSP operation: ${options.operation}`);
  }

  return formatResult(options.operation, result);
}

/** Test helper / cleanup. */
export function disposeAllLspClients(): void {
  for (const [, client] of clients) {
    try {
      client.proc.kill();
    } catch {
      // ignore
    }
  }
  clients.clear();
}
