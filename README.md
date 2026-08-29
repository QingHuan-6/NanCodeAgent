# NanCodeAgent

A minimal **self-hosted coding agent** harness: local tools + OpenAI-compatible tool calling.

Inspired by Pi / Claude Code / Codex architecture notes in `docs/`, without agent frameworks (no LangChain, Agents SDK, etc.).

## Status

**Scaffold (Phase 0).** Agent loop, LLM client, tool registry, permissions hooks, and CLI are wired. The four MVP tools are **stubs** — implement in Phase 1.

## Setup

```bash
npm install
copy .env.example .env
# edit .env — set NAN_API_KEY (and optionally NAN_BASE_URL / NAN_MODEL)
```

## Run

```bash
npm run dev -- "your programming task"
npm run build && npm start -- "your programming task"
```

## Layout

```
src/
  index.ts          CLI entry
  config.ts         env config
  llm/              OpenAI-compatible client + types
  tools/            registry + read/write/edit/bash (stubs)
  agent/            loop, system prompt, events
  session/          message history (+ optional JSONL)
  permissions.ts    workspace path gate + dangerous cmd ask
  cli/printer.ts    event → stdout (UI separate from loop)
```

## Secrets

API keys only via environment / `.env` (gitignored). Never commit credentials.
