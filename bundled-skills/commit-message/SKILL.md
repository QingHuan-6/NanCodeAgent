---
name: commit-message
description: >-
  Write a concise English git commit message from the current diff and recent
  log style. Use when the user asks for a commit message, commit text, or help
  committing without inventing unrelated changes.
---

# Commit message skill

## Steps

1. Run `git status` and `git diff` (and `git diff --staged` if anything is staged).
2. Run `git log -5 --oneline` to match this repo's message style.
3. Draft **1–2 short sentences** in **English**, imperative mood (e.g. "Add …", "Fix …").
4. Focus on **why** when helpful; do not list every file.
5. Do **not** create the commit unless the user explicitly asks you to commit.
6. Never include secrets (API keys, `.env` contents) in the message.

## Output

Show the proposed message in a fenced block the user can copy, for example:

```text
Add skill discovery and on-demand skill tool.

Advertise SKILL.md name/description in the system prompt; load full body via the skill tool.
```
