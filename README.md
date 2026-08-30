# NanCodeAgent

A minimal **self-hosted coding agent** harness: local tools + OpenAI-compatible tool calling.

No agent frameworks (no LangChain, Agents SDK, etc.): the harness loop, tools, and LLM client are implemented in-repo.

## Status

Interactive Ink TUI + parallel tools + steer + glob/grep + plan mode + todo_write + ask_user + web_fetch/web_search + lsp + **skills** + LLM /compact + tool-output spill + session resume.

## Setup

```bash
git clone <your-repo-url> NanCodeAgent
cd NanCodeAgent
npm install
npm run dev
```

First launch asks for provider / API key / model, then saves to:

```text
~/.nan-agent/.env
```

After that you can run from **any folder** (workspace = current directory), as long as Node can find the CLI (see below). Re-run setup anytime:

```bash
npm run dev -- --setup
# or inside REPL:
/setup
```

Optional: still support project-local `.env` (overrides user config for that repo). Never commit secrets.

## Run

```bash
# Interactive TUI — stream, spinner, file diffs
npm run dev

# Classic readline REPL
npm run dev -- --plain

# One-shot (colored streaming printer)
npm run dev -- "Create a hello.py that prints hi"
```

Inside TUI / REPL: `/help` `/status` `/plan` `/agent` `/clear` `/compact` `/continue` `/sessions` `/resume` `/exit`  
While busy in TUI: **Enter steers** (injects after current tools); Esc aborts.  
Setup: `nan-agent --setup` (or `/setup` in `--plain` mode)

**Modes:** `/plan` = read-only (read/glob/grep + todo/ask/web/lsp). `/agent` = full tools (write/edit/bash + the same).  
Multi-step work: the model can call `todo_write` to keep a live checklist (shown above the prompt).  
Clarifying questions: `ask_user` (TUI options / free text). Public docs: `web_search` + `web_fetch` (SSRF-blocked). Code intel: `lsp` (TS/JS via typescript-language-server, Python via pyright — first call may `npx` download).  
**Skills (any folder):** built-in skills ship in `bundled-skills/` (`commit-message`, `skill-creator`). Also scans Claude/OpenCode-compatible dirs and walks up to the git root.  
**Remote catalogs (OpenCode-style):** put URLs/dirs in `.nan/skills.json` or `~/.nan-agent/skills.json`:

```json
{ "skills": ["https://example.com/opencode/skills/", "~/shared-skills"] }
```

HTTP bases must serve `index.json` (`name` / `version` / `files`); Nan caches under `~/.nan-agent/skills-cache/` and refreshes when `version` changes. Or ask the agent: `用 skill_install 安装 https://…/skills/`（可用 `global: true`）. Env: `NAN_SKILL_SOURCES`.  
Large tool output is saved under `.nan/tool-output/` with a short summary returned to the model.

### Use from any folder (global)

```bash
cd NanCodeAgent
npm run link:global
```

Then in any project:

```bash
cd D:\some-other-project
nan-agent              # REPL — workspace = this folder
nan-agent --setup      # change API key / model
nan-agent "fix hello"  # one-shot
```

API config is read from `%USERPROFILE%\.nan-agent\.env` (set on first run).

Unlink later: `npm unlink -g nan-code-agent`

## Test

```bash
npm test
```

Layout: dedicated `test/` (tools, agent, llm, cli), Vitest, no live API required.

## Layout

```
src/
  index.ts          CLI entry (setup / TUI / plain / one-shot)
  config/           runtime config + ~/.nan-agent .env
  llm/              OpenAI-compatible client (+ SSE stream)
  tools/            read/write/edit/bash/glob/grep/todo/ask/web/lsp/skill (+ spill)
  skills/           SKILL.md discovery + catalog helpers
  bundled-skills/   built-in skills shipped with the npm package
  agent/            loop, runtime, prompt, events
  session/          message history + resume + todos
  lsp/              minimal stdio LSP client
  permissions.ts    workspace gate
  cli/              printer, REPL, TUI, slash, setup
test/               Vitest suite
```

Not in scope for this harness (product-scale): MCP, notebooks, sub-agents.
## Secrets

API keys live in environment, project `.env`, or `~/.nan-agent/.env` — never in the git repo.
