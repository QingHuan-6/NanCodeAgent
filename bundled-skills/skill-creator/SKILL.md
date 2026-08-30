---
name: skill-creator
description: >-
  Create or update NanCodeAgent skills (SKILL.md). Use when the user wants a new
  skill, to turn a finished workflow into a reusable skill, to improve an
  existing skill's description or body, or asks how to install/author skills by
  talking to the agent.
---

# Skill creator (Nan)

Help the user **author and install** a local skill by writing files the harness already discovers. There is no separate marketplace install tool — **install = write `SKILL.md` into a skills root**.

Built-in skills (`skill-creator`, `commit-message`, …) ship inside the **nan-agent package** (`bundled-skills/`) and work from **any workspace**. User/project skills override bundled ones by the same `name`.

## Install from the network (OpenCode HTTP catalog)

Prefer `skill_install` over inventing curl scripts:

1. Ask the user for the catalog base URL (must host `index.json`).
2. Call `skill_install` with `source` = that URL; set `global: true` if they want it in every project.
3. On the next turn, load individual skills with the `skill` tool.

Manual config equivalent — `.nan/skills.json` or `~/.nan-agent/skills.json`:

```json
{ "skills": ["https://example.com/skills/"] }
```

`index.json` shape:

```json
{
  "skills": [
    {
      "name": "git-release",
      "version": "3",
      "files": ["git-release.md", "references/policy.md"]
    }
  ]
}
```

Files are downloaded from `{base}/{name}/…` into `~/.nan-agent/skills-cache/`.

## Capture intent

1. What should the agent do when this skill loads?
2. **When** should it trigger? (phrases, task types — this goes in `description`)
3. Scope:
   - **Global** (recommended if they said “别的项目也能用” / “everywhere”) → home skills dir
   - **Project** (default for repo-specific workflows) → workspace `.agents/skills`
4. Optional: `scripts/`, `references/`, `assets/` companions?

If the user said “把刚才那套做成 skill”, extract steps from the conversation first, then confirm.

Use `ask_user` when scope is ambiguous (project vs global).

## Where to write (Nan discovery)

| Scope | Path | When |
|-------|------|------|
| **Global (use from any folder)** | `%USERPROFILE%\.agents\skills\<name>\SKILL.md` (or `~/.agents/skills/…`) | User wants it in every project |
| Global (Nan-only) | `%USERPROFILE%\.nan-agent\skills\<name>\SKILL.md` | Prefer Nan-specific home |
| Also scanned | `~/.claude/skills`, `~/.config/opencode/skills` | Compat with Claude / OpenCode |
| Project (git-friendly) | `{workspace}/.agents/skills/<name>/SKILL.md` | Default for this repo only |
| Project | `{workspace}/.claude/skills/`, `.opencode/skills/`, `skills/`, `.nan/skills/` | Compat / Nan-local |

Nan also walks **up toward the git root** for project skill dirs (OpenCode-style), so a monorepo root skill applies in subfolders.

**Do not** put new skills only under the NanCodeAgent source tree if the user runs `nan-agent` elsewhere — that will not follow them. Use **global** or the **current workspace**.

## Naming and frontmatter

- `name`: kebab-case, e.g. `pr-review` (`^[a-z0-9]+(?:[-_][a-z0-9]+)*$`)
- Prefer **directory name == `name`**
- `description`: **trigger-heavy** — what it does **and** when to use it
- Optional: `disable-model-invocation: true` (rare)

```markdown
---
name: example-skill
description: >-
  Do X when the user asks about Y or Z. Use whenever … even if they do not say
  the word "skill".
---

# Example skill

## Steps
1. …
2. …

## Avoid
- …
```

## Body writing rules

- Imperative steps; keep **under ~200 lines** when possible.
- Point to companions: “read `references/foo.md` when …”.
- Only reference tools Nan actually has: `read_file`, `write_file`, `edit_file`, `bash`, `glob`, `grep`, `todo_write`, `ask_user`, `web_fetch`, `web_search`, `lsp`, `skill`.
- No secrets in the skill file.
- Do not create malware or deceptive skills.

## Install procedure (you do this)

1. Agree on `name`, `description`, scope, and outline (use `ask_user` if needed).
2. `write_file` (or `edit_file`) the `SKILL.md` at the chosen path.
3. Optionally add `references/` or `scripts/` with `write_file`.
4. Tell the user:
   - Exact path written
   - **Global** skills apply the next turn in any folder; **project** skills apply in that repo (and subdirs up to git root)
   - They can say “load the \<name\> skill” to verify
5. Improving an existing skill: search under the roots above, then edit; re-load with the `skill` tool to confirm.

## Improving descriptions

If a skill rarely triggers: rewrite `description` to list concrete user phrasings (slightly “pushy”), without stuffing the full workflow into the description.

## Do not

- Invent a non-existent `install_skill` tool unless the user explicitly wants `npx skills add …` via `bash`.
- Write only into the NanCodeAgent git checkout when the user’s workspace is another project.
- Put skills under `~/.cursor/skills-cursor/` (Cursor-reserved).
- Commit or push unless the user asks.
