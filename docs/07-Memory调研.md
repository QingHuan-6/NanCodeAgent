# 06+ — Memory 调研（指令 / 自动笔记 / 会话连续）

> 调研日期：2026-08-30  
> 目的：分清 coding agent 里常说的「记忆」到底指什么；对照 Nan 缺口；给出课设可落地的最小方案。  
> 相关已有笔记：[`03-上下文管理`](./03-上下文管理调研与落地.md)（compact）、[`04-Harness`](./04-Harness-长跑应用开发.md)（PROGRESS / reset）、[`06-Skills`](./06-Skills-Subagent-MCP调研.md)。

---

## 0. 先分清：四种「记忆」不是一回事

| 类型 | 谁写 | 何时进上下文 | 典型产品形态 | Nan 现状 |
|------|------|--------------|--------------|----------|
| **A. 指令记忆** | 人（可 git） | 每会话 system / user context | `AGENTS.md` / `CLAUDE.md` / Cursor rules | 有：读 `AGENTS.md`/`CLAUDE.md`/`.nan/AGENTS.md` + `.cursor/rules`（有上限） |
| **B. 自动笔记** | 模型自己 | 启动加载索引；细节按需读文件 | Claude Auto Memory (`MEMORY.md`) | **无** |
| **C. 会话连续** | harness | 当前/恢复的 transcript | Session JSONL + `/resume` + `/compact` | 有 |
| **D. 外置工作记忆** | 人+模型约定文件 | JIT `read_file` | `PROGRESS.md` / todo / NOTES | 弱：有 `todo_write`；无官方 PROGRESS 约定 |

社区口头说的「记忆系统」，多数 = **A+B**（跨会话偏好/规则），不是向量数据库。  
**向量 RAG / Mem0** 多在插件/MCP 层，主流 coding CLI **内核**很少默认上 embedding。

---

## 1. 统一心智模型

```text
Session start
  ├─ A: load instruction chain (global → project → nested cwd)
  ├─ B: load MEMORY.md head (budget-capped index)
  ├─ C: load / resume transcript (or empty)
  └─ tools/skills ads…

During work
  ├─ model may write B (topic files) when it learns durable facts
  ├─ model may update PROGRESS / todos (D)
  └─ overflow → compact (C)：摘要旧轮；A 应仍在 system（勿只靠摘要「记住规则」）

Next session (new chat, same repo)
  ├─ A + B 仍在 → 「还记得项目规矩」
  └─ C 默认空（除非 /resume 旧 session）
```

关键洞察（Anthropic / Claude Code 文档一致）：

- 记忆是 **context，不是强制配置**；要硬拦行为用 hooks/权限，不要指望 md 文件。
- **越短越被遵守**；索引文件有硬预算（Claude：`MEMORY.md` 前 200 行或 25KB）。
- Compact ≠ 跨会话记忆：compact 救的是**当前长会话**；跨会话靠 **A/B/D 文件**。

---

## 2. 各家怎么做

### 2.1 Claude Code（目前最完整的「产品记忆」）

官方：[How Claude remembers your project](https://code.claude.com/docs/en/memory)

**A — CLAUDE.md 层级（人写）**

| 范围 | 路径（示意） |
|------|----------------|
| 托管策略 | 企业 managed |
| 用户全局 | `~/.claude/CLAUDE.md` |
| 项目 | `./CLAUDE.md` 或 `./.claude/CLAUDE.md` |
| 本地私有 | `./CLAUDE.local.md`（通常不提交） |
| 路径规则 | `.claude/rules/*.md`（可 glob） |

多文件 **拼接进 context**，不是严格「高层覆盖低层」。`/init` 可生成/补全项目说明。

**B — Auto Memory（模型写）**

- 目录：`~/.claude/projects/<project>/memory/`
- 入口：`MEMORY.md`（索引）；细节拆到 `debugging.md` 等 topic 文件  
- 启动只灌索引头；topic **用普通读文件工具按需拉**（不是向量检索）  
- 默认开；`/memory` 开关；`autoMemoryEnabled` / `CLAUDE_CODE_DISABLE_AUTO_MEMORY`  
- **不进 git**（个人笔记本）；团队规矩放 CLAUDE.md  

另有 **Session Memory**（会话摘要目录）用于工作连续性，仍偏文件而非 embedding。

### 2.2 Codex（OpenAI）

- **A 为主**：仓库级 `AGENTS.md`（及 agents 配置）；developer instructions 有大小上限。  
- **C**：thread/session + 服务端 `/responses/compact`（偏 API 侧摘要）。  
- **B**：内核不像 Claude 那样默认「自动写 MEMORY.md」；跨工具持久化常靠社区 MCP/插件。  
- 长跑实践（见 Nan `04`）：鼓励 **PROGRESS.md + commit**，用文件扛跨窗口，而不是无限 compact。

### 2.3 OpenCode

- **A**：`AGENTS.md` / `CLAUDE.md`（目录内常二选一或兼容加载）+ 嵌套发现。  
- **C**：session compaction；社区反复踩坑：**compact 后丢掉规则遵守感**（摘要模型没看见 AGENTS 内容 / 未 re-inject）。对策方向：  
  - compact prompt 强制「Rules & Constraints」段  
  - preserve prefix（工具+system 与主 agent 一致，利于 cache）  
  - pin 消息跨 compact 存活（实验/需求）  
- **B**：有「高级双范围 memory」类 feature 讨论，**不如 Claude 文档化成熟**。

### 2.4 DeepSeek Harness

- **A 很重**：`$DSH_HOME/AGENTS.md` + 从 project root → cwd 的 `AGENTS.md`/`CLAUDE.md` 链；可配 local overlay（`AGENTS.local.md`）；有 `maxBytes` 预算与去重。  
- 指令链是 **durable session context**，不是改全局 process system。  
- **B**：未见与 Claude 同级的默认 Auto Memory 产品叙述；更强调 **instruction files + compact/session**。  
- Cursor bridge 可把 `.cursor/rules` 当 memory 注入（桥接层）。

### 2.5 Cursor（IDE）

- **A**：`.cursor/rules/*.mdc`（`alwaysApply` / glob）+ 兼容读 `AGENTS.md`/`CLAUDE.md` 的实践。  
- 最佳实践：以 **AGENTS.md 为单一真相**，工具专属文件只 `@import`，避免三份拷贝。  
- 记忆形态仍是 **规则文件 + 聊天/Composer 上下文**，不是独立向量记忆内核。

---

## 3. 对照表（课设视角）

| | Claude | Codex | OpenCode | DSH | **Nan** |
|--|--------|-------|----------|-----|---------|
| 指令文件 | CLAUDE.md 多层 | AGENTS.md | AGENTS/CLAUDE | AGENTS 链 + local | 项目内几种 + rules 片段 |
| 用户全局指令 | `~/.claude/CLAUDE.md` | 用户 config / agents | 有用户级配置 | `~/.dsh/AGENTS.md` | **缺**（仅 API `.env`） |
| 模型自写笔记 | MEMORY.md + topics | 弱/外置 | 弱/实验 | 弱 | **无** |
| Session 恢复 | 有 | thread | 有 | 有 | JSONL `/resume` |
| Compact | 多层 + LLM | API compact | session compact | 有 | LLM `/compact` |
| 向量记忆 | 非默认内核 | 非默认 | 非默认 | 非默认 | 不做 |

---

## 4. Nan 缺口与建议（按性价比）

### 已有（够演示「不是失忆聊天框」）

1. Session 落盘 + `/resume`  
2. `/compact`（会话内连续）  
3. 启动注入项目 `AGENTS.md` 等  
4. `todo_write`（短程工作记忆）  
5. Skills（任务型说明，≠ 项目记忆）

### 建议做（课设「记忆」MVP，对齐 Claude 简化版）

**P0 — 补齐指令链（仍属 A）**

- 增加用户全局：`~/.nan-agent/AGENTS.md`（或 `MEMORY` 无关的 instructions）  
- 与项目文件拼接进 `buildSystemPrompt`，总预算继续截断  
- 文档写清：规矩放 AGENTS；别指望 chat 自己「永久记住」

**P1 — 文件型 Auto Memory（B，无向量）**

```text
~/.nan-agent/projects/<workspace-hash>/memory/
  MEMORY.md          # 索引，启动注入前 N 行 / M 字符
  *.md               # topic；模型用 read_file / 专用 tool 读写
```

- 工具：`memory_read` / `memory_write`（或约定写路径 + 普通 write，权限收紧到 memory 目录）  
- System 一句：学到可复用偏好/构建命令/坑时写入；索引保持短  
- **默认本地、不进业务 git**（与 Claude 一致）

**P2 — 外置工作记忆约定（D）**

- Prompt/README：长任务维护 `.nan/PROGRESS.md`（或根目录 `PROGRESS.md`）  
- compact 摘要提示保留「下一步 + 关键路径」（你们 compact 已可带 instructions）

### 明确不做（截止日前）

- Embedding / 向量检索 / Mem0 类云记忆  
- 跨产品同步记忆（Claude↔Codex MCP 桥）  
- Compact 后「魔法恢复全部规则」的复杂 pin 系统（优先：**规则活在 system 的 A，不靠摘要扛**）

---

## 5. 和 Skills / Subagent / Compact 的边界

| 机制 | 解决什么 | 不解决什么 |
|------|----------|------------|
| Skills | 可复用任务流程 | 用户偏好、项目永久规矩 |
| Subagent | 隔离上下文做子任务 | 跨会话知识积累 |
| Compact | 当前会话塞不下 | 新开聊天仍「认识你」 |
| AGENTS.md (A) | 团队/个人硬规矩 | 会话中临时学到的细节 |
| Auto memory (B) | 跨会话软知识 | 强制安全策略 |
| PROGRESS (D) | 长跑交接 | 日常闲聊偏好 |

Anthropic 长程三杠杆仍成立：**Compact · Note-taking · Sub-agents**；其中 Note-taking 在产品化后拆成 **人写 A + 模型写 B + 任务文件 D**。

---

## 6. 参考链接

- Claude Memory：https://code.claude.com/docs/en/memory  
- Claude Auto Memory 解读：https://claudefa.st/blog/guide/mechanics/auto-memory  
- DSH agent-instructions：https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md  
- OpenCode compaction / rules 保留：https://github.com/anomalyco/opencode/issues/4102 、https://github.com/anomalyco/opencode/issues/16960  
- Nan：[`03-上下文管理`](./03-上下文管理调研与落地.md)、[`04-Harness`](./04-Harness-长跑应用开发.md)

---

## 7. 待办勾选

- [x] P0：`~/.nan-agent/AGENTS.md` 全局指令注入  
- [x] P1：user 目录下 `MEMORY.md` 索引 + `memory` 工具（list/read/write/append，无向量）  
- [x] P2：PROGRESS.md / `.nan/PROGRESS.md` 注入 + prompt 约定；`/memory` 路径查看  
- [x] README 写清「记忆 = 文件，不是向量库」  
- [ ] （不做）Embedding / 跨 CLI 记忆同步  
