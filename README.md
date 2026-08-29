# NanCodeAgent

A minimal **self-hosted coding agent** harness: local tools + OpenAI-compatible tool calling.

Inspired by Pi / Claude Code / Codex architecture notes in `docs/`, without agent frameworks (no LangChain, Agents SDK, etc.).

## Status

**Phase 0–1 (partial).** Agent loop and OpenAI-compatible LLM client are in place. The four MVP tools are still **stubs** — implement next for real coding tasks.

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
  llm/              OpenAI-compatible client (retry, stream, errors)
  tools/            registry + read/write/edit/bash (stubs)
  agent/            loop, prompt, events, doom-loop, tool-runner
  session/          message history (+ optional JSONL)
  permissions.ts    workspace path gate + dangerous cmd ask
  cli/printer.ts    event → stdout (UI separate from loop)
```

Local study clones live in `refs/` (gitignored).

## Secrets

API keys only via environment / `.env` (gitignored). Never commit credentials.
