# 05 — 执行前 Todo / 计划清单：开源实现调研

> 笔记日期：2026-08-29  
> 问题：成熟 coding agent 为何「先写几个 todo 再动手」？开源里怎么做的？Nan 怎么轻量落地？  
> 相关：[`04-Harness-长跑应用开发.md`](./04-Harness-长跑应用开发.md)（feature list / sprint）、[`03-上下文管理调研与落地.md`](./03-上下文管理调研与落地.md)

---

## 0. 结论先看

开源主流 **不是** 靠 system prompt 空喊「先规划」，而是给模型一个 **极轻量的清单工具**：

1. 多步任务开局 → **整表写入** pending todos  
2. 动手前把当前项标 `in_progress`（通常 **同时只能有 1 个**）  
3. 做完立刻标 `completed`，再开下一项  
4. UI / TUI 旁路渲染进度（工具本身几乎不占「干活」token）

清单 **外置于对话语义**：状态在 session store，不靠模型「记得自己说过要做什么」。这和 Anthropic 长跑 harness 里的 `feature_list.json` / progress 文件是同一族思想——**结构化交接物**，只是粒度更细、生命周期更短（单会话）。

对 Nan：一个 `todo_write`（全量替换）+ 内存/session 状态 + TUI 侧栏一行摘要，就够课设用；不必先上 TaskCreate 依赖图。

---

## 1. 为什么要「先 Todo」

| 痛点 | Todo 怎么帮 |
|------|-------------|
| 一次做太多 / 漏步骤 | 强制拆成可勾选项 |
| 中途偏航 | 当前 `in_progress` 锚定焦点 |
| 用户看不见进度 | TUI 显示清单，不必读长 assistant 散文 |
| compact / 新窗口后失忆 | 清单若持久化，比对话摘要更稳（Tasks API / 文件） |
| 「假完成」 | 规则：测挂、半成品不得标 completed |

和 **Plan mode** 的区别：

- **Plan mode**：只读探索 + 出方案（Nan 已有 `/plan`）。  
- **Todo 工具**：进入实现阶段后的 **执行清单**；可以与 plan 衔接（plan 批准 → 物化成 todos）。

---

## 2. 开源实现对照

### 2.1 Claude Code — TodoWrite（经典）→ Tasks API（新）

**TodoWrite（V1，仍广泛被 OpenCode 等抄）**

- 工具名：`TodoWrite`（有的环境还有 `TodoRead`）。  
- **语义：整表原子替换**（不是 merge-by-id）。模型每次交完整 `todos[]`。  
- 典型字段：`content`、`status`、`priority`；Claude 版还强调 **`activeForm`**（进行时文案，UI 显示「Running tests」而不是「Run tests」）。  
- 状态：`pending` | `in_progress` | `completed`（OpenCode 另加 `cancelled`）。  
- `shouldDefer: true`：可延后/不挡主路径；权限通常直接 allow。  
- 全部完成时有的实现会清空列表；还有 verification nudge（≥3 项完成且无 verify 字样 → 提醒 spawn verifier）。

**Prompt 核心规则（Claude / OpenCode 几乎同文）：**

```text
何时用：≥3 步、非琐碎、用户给多任务、新指令、开工前标 in_progress、完成后立刻勾
何时不用：单步/琐碎/纯问答
硬规则：同时 ideally/exactly ONE in_progress；完成立即标记；勿批量勾完；
         半成品/失败测试禁止标 completed
```

**Tasks API（约 v2.1.16+）** — 增量式、可持久化：

| 工具 | 作用 |
|------|------|
| `TaskCreate` | 建一条，返回 `taskId` |
| `TaskUpdate` | 改 status / subject；`deleted` 删除 |
| `TaskGet` / `TaskList` | 读回 |
| （另有）依赖 `blocks` / `blockedBy`、owner、多 agent | 跨会话 / 多终端 |

- 落盘：`~/.claude/tasks/`（或 task list id）。  
- 适合：跨 session、依赖图、多 agent。  
- 新模型（Opus 4.8+ 等）默认可能 **关掉** todo 工具（模型自己能跟多步）；SDK 需 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` 才露出——说明 Anthropic 认为 **清单是 harness 能力，不是永远绑死模型**。

官方文档：https://code.claude.com/docs/en/agent-sdk/todo-tracking  

开源镜像/分析：

- TodoWrite：`zackautocracy/claude-code` … `TodoWriteTool`  
- TaskCreate：`LING71671/Open-ClaudeCode` … `TaskCreateTool`  
- 对照文档：`fractary/pi-claude-code` `docs/task-management.md`  
- 工作流指南：`FlorianBruniaux/claude-code-ultimate-guide` `guide/workflows/task-management.md`

### 2.2 OpenCode — `todowrite`

源码：`anomalyco/opencode` → `packages/opencode/src/tool/todo.ts` + `todowrite.txt`

```text
工具名: todowrite
参数: { todos: [{ content, status, priority }] }
执行: Todo.Service.update({ sessionID, todos })  // 全量替换
返回: title = "N todos"，output = JSON.stringify(todos)
```

- Prompt 与 Claude TodoWrite **高度同构**（when to use / not use / ONE in_progress）。  
- 状态挂在 **session**，TUI/API 可 `GET/POST …/todo`；插件可写 sidebar。  
- 权限名：`todowrite`（可 ask，但常 always allow）。  
- **没有** 单独的 TodoRead 工具时，模型靠 tool_result 回显 + 下次再整表写。

Nan 的 `docs/01` 已记协作工具含 `todowrite`——与此一致。

### 2.3 Codex — `update_plan`

Pi 侧兼容包：`@carter-mcalister/pi-codex-tasks`

```json
{
  "explanation": "optional note",
  "plan": [
    { "step": "Inspect the code", "status": "completed" },
    { "step": "Patch the bug", "status": "in_progress" },
    { "step": "Run validation", "status": "pending" }
  ]
}
```

- **整份 plan 替换**，字段更瘦：只有 `step` + `status`（无 id / priority / activeForm）。  
- UI：任务摘要条、✔/◼/◻、in_progress 转圈、`/tasks` 菜单。  
- 与 Claude Task* **刻意不混用**（不同产品表面）。

### 2.4 Cursor（本仓库技能侧）

Cursor 会话里的 `TodoWrite`：

- `todos: [{ id, content, status }]`  
- **`merge: true|false`**：false 全量替换；true 按 id upsert——比 Claude/OpenCode 的纯 replace 多一档。  
- 状态：`pending` | `in_progress` | `completed` | `cancelled`  
- 约束：创建时至少 2 项；适合「agent 自己管进度」。

### 2.5 其它变体（了解即可）

| 项目 | 模式 |
|------|------|
| **oh-my-opencode** | `task_create/get/list/update` 落盘到项目 task 目录，再 **sync** 到 OpenCode session todo UI |
| **MandoCode** | `propose_plan` 工具 → **UI 审批**（Execute / Reject）→ 再逐步执行（人在环） |
| **task-orchestrator** | Plan mode hook：pre-plan 设 definition floor → 用户批准 → post-plan **物化** MCP work items 再编码 |
| **autorun / superpowers** | Hook 提醒「该更新任务了」；技能文案从 TodoWrite 迁到 TaskCreate/Update |

---

## 3. 实现模式拆解（可抄的最小集）

### 3.1 数据流

```text
Model
  └─ tool_call: todowrite({ todos: [...] })
        │
        ▼
  SessionTodoStore.update(sessionId, todos)   // 内存 + 可选 JSONL/文件
        │
        ├─ tool_result → 回给模型（确认当前表）
        └─ event: todo.updated → TUI 重绘清单
```

**不要**把完整 todo JSON 每轮塞进 system prompt（浪费 + 易与 store 不同步）。模型通过：

- 自己刚写的 tool_result，或  
- 必要时再调 write/list  

保持一致即可。

### 3.2 API 选型建议

| 方案 | 优点 | 缺点 | Nan 建议 |
|------|------|------|----------|
| **A. 单工具全量替换**（TodoWrite / OpenCode / Codex） | 实现极简；模型不易丢 id | 大列表每次重发 | **Phase 1 首选** |
| **B. Create + Update**（Tasks API） | 增量、依赖、持久化 | 工具多、状态机复杂 | Phase 2+ |
| **C. merge 开关**（Cursor） | 灵活 | prompt 要讲清 merge | 可选增强 |
| **D. 仅文件**（PROGRESS.md / feature_list.json） | 跨 session、人可编辑 | 无结构化 UI；靠模型自觉 | 与 A 互补（长跑） |

### 3.3 Prompt 必备句（精简版可放进 tool description）

```text
- Use for ≥3 distinct steps; skip trivial one-shot tasks.
- Exactly one item in_progress at a time; mark completed immediately when done.
- Never mark completed if tests fail or work is partial.
- Replace the full list each call (unless merge is supported).
```

### 3.4 UI 最小呈现

```text
● 3 tasks · 1 done · 1 doing · 1 open
  ✔ Scaffold module
  ◼ Writing auth middleware     ← in_progress（可转圈）
  ◻ Add tests
```

工具卡片可折叠成一行：`Updated todos (3)`，详情展开 JSON/列表。

### 3.5 与 Plan / Compact 的衔接

```text
/plan 产出方案
    ↓（用户批准或 agent 自行进入 agent mode）
todowrite 物化 4～8 条可执行项
    ↓
边做边更新 status
    ↓
/compact 或新 session
    → 若 store 持久化：恢复 todos；否则摘要里应含「剩余 todo」
```

Anthropic 长跑文（04）里的 JSON feature list = **跨很多窗口的重型 todo**；会话内 TodoWrite = **轻型同构物**。

---

## 4. 对 NanCodeAgent 的落地草案

### Phase 1（建议做）

```text
src/tools/todo_write.ts
  - name: todo_write
  - params: { todos: [{ id?, content, status, priority? }] }
  - execute: 写入 ctx 或全局 SessionTodo（按 session）
  - 返回精简确认 + 当前列表

src/session/todo.ts   // 或挂在 Session 上
  - get/set/replace
  - 可选写入 .nan/todos.json（gitignore）

TUI: 输入框上方或 status 行显示摘要；timeline 可用 activity 行
  • Updated plan · 1/4 in progress
```

System / tool policy 一句：复杂任务请先 `todo_write`。

### Phase 2（可选）

- `todo_read`（或 list）  
- merge-by-id  
- compact 后把未完成 todo 注入摘要  
- `/todos` slash 查看  

### 不做（短期）

- Task 依赖图、多 agent broadcast、`~/.claude/tasks` 云同步  
- 强制「无 todo 禁止 edit」（过硬，弱模型会卡）——最多 soft nudge  

### 测试要点

- 全量替换语义  
- 非法 status 拒绝  
- 同时多个 in_progress：实现层可 **自动纠正**（只保留最后一个）或仅靠 prompt  
- Plan mode：可允许 todo_write（只读工具集之外的「元工具」）或禁止——建议 **允许**（规划清单不算改代码）

---

## 5. 参考链接

- Claude Agent SDK Todo：https://code.claude.com/docs/en/agent-sdk/todo-tracking  
- OpenCode `todowrite`：https://github.com/anomalyco/opencode/blob/51e310c9/packages/opencode/src/tool/todo.ts  
- OpenCode prompt：https://github.com/anomalyco/opencode/blob/51e310c9/packages/opencode/src/tool/todowrite.txt  
- Claude TodoWrite prompt（镜像）：https://github.com/zackautocracy/claude-code/blob/4b9d30f7/src/tools/TodoWriteTool/prompt.ts  
- Codex `update_plan`（Pi 包）：https://github.com/CarterMcAlister/pi-packages/tree/main/packages/pi-codex-tasks  
- Tasks vs TodoWrite 指南：https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/guide/workflows/task-management.md  
- 姊妹笔记：[`04-Harness-长跑应用开发.md`](./04-Harness-长跑应用开发.md)

---

## 6. 待办勾选（实现时更新）

- [x] 实现 `todo_write` 工具 + session store  
- [x] TUI 进度摘要  
- [x] tool description 写入 when/when-not 规则  
- [x] （可选）`.nan/todos.json` 持久化与 resume  
- [ ] （可选）compact 保留未完成项  
