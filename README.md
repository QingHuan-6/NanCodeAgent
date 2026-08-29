# NanCodeAgent

A minimal **self-hosted coding agent** harness: local tools + OpenAI-compatible tool calling.

No agent frameworks (no LangChain, Agents SDK, etc.): the harness loop, tools, and LLM client are implemented in-repo.

## Status

Interactive REPL + agent loop + LLM client + local tools (`read_file` / `write_file` / `edit_file` / `bash`).

## Setup

```bash
npm install
copy .env.example .env
# edit .env — set NAN_API_KEY (and optionally NAN_BASE_URL / NAN_MODEL)
```

## Test

```bash
npm test
```

Layout: dedicated `test/` (tools, agent, llm, cli), Vitest, no live API required.

## Run

```bash
# Interactive (Claude Code–style): keep asking in one session
npm run dev

# One-shot
npm run dev -- "Create a hello.py that prints hi"
```

Inside the REPL:

- Type a task and press Enter
- `/help` `/status` `/clear` `/exit`

## Layout

```
src/
  index.ts          CLI entry (REPL or one-shot)
  config.ts         env config
  llm/              OpenAI-compatible client (retry, stream, errors)
  tools/            registry + read/write/edit/bash (local)
  agent/            loop, prompt, events, doom-loop, tool-runner
  session/          message history (+ optional JSONL)
  permissions.ts    workspace path gate + dangerous cmd ask
  cli/              printer, REPL, slash commands
test/               Vitest suite (tools / agent / llm / cli)
```

Local study clones live in `refs/` (gitignored).

## Secrets

API keys only via environment / `.env` (gitignored). Never commit credentials.
