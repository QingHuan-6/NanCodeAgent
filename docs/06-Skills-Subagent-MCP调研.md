# 06 — Skills / Sub-agent / MCP：OpenCode · Codex · DeepSeek Harness 对照

> 笔记日期：2026-08-29  
> 目的：搞清这三块「产品级扩展」在开源里怎么做，Nan 若要抄该抄哪一层。  
> 相关：[`03-上下文管理调研与落地.md`](./03-上下文管理调研与落地.md)、[`01-开源Code-Agent技术方案整理.md`](./01-开源Code-Agent技术方案整理.md)

---

## 0. 结论先看

| 能力 | 共性设计 | Nan 可抄的最小形态 | 不要先抄的部分 |
|------|----------|-------------------|----------------|
| **Skills** | `SKILL.md` + frontmatter `name`/`description`；**广告进 prompt，正文按需加载** | 扫目录 → prompt 短列表 → `skill` 工具读正文 | OAuth、插件市场、隐式自动触发策略 |
| **Sub-agent** | 父 agent 调工具 → **新 session/thread** → 子循环 → **摘要回父**；限 depth | 同步 `task`：裁剪工具 + 独立 messages + 返回 text | 后台并行、跨产品桥（Claude/Codex CLI）、continuable 多轮子会话 |
| **MCP** | 外部进程/HTTP 暴露 tools → **转成本地 ToolRegistry 条目** | （课设可不做）stdio + `listTools`/`callTool` 骨架 | Streamable HTTP、SSE 回退、OAuth DCR、resources/prompts |

三者关系（Codex 文档原话同构）：

```text
AGENTS.md / 常驻说明     → 永远在（薄）
Skills                   → 可复用工作流（按需）
MCP                      → 连外部系统（工具源）
Sub-agents               → 隔离/并行执行（执行单元）
```

Skills 经常 **声明依赖 MCP**；Sub-agent 可继承或裁剪 MCP/skills。Nan 没有 MCP 也能先做 Skills；Sub-agent 不依赖 MCP。

---

## 1. Skills（progressive disclosure）

### 1.1 统一契约（三家几乎一致）

目录形态：

```text
my-skill/
  SKILL.md          # 必填：YAML frontmatter + Markdown 正文
  references/       # 可选
  scripts/          # 可选
  assets/           # 可选
```

Frontmatter 最小集：

```yaml
---
name: my-skill          # 常要求 kebab-case
description: When to use … what it does …   # 决定「会不会被想起」
---
```

**分层加载（三家都强调）：**

1. **L0 广告**：只把 `name` + `description`（+ 路径）放进 system / catalog  
2. **L1 正文**：模型调用 `skill`（或用户 `/skill-name`）后才注入 `SKILL.md` body  
3. **L2 附件**：脚本/参考文档再由模型 `read` / 执行，不预先塞满上下文  

这和「把所有 workflow 写进 system prompt」相反——为的是 **省 token + 保前缀缓存稳定**。

### 1.2 OpenCode

**发现层** `packages/opencode/src/skill/`：

- Glob：`skills/**/SKILL.md`、`{skill,skills}/**/SKILL.md`，以及兼容外部 `**/SKILL.md`
- 解析 frontmatter → `{ name, description, location, content }`
- 重名 warn；扫描失败发 session error，不炸进程

**工具层** `tool/skill.ts`：

- 参数：`name`（必须来自 available_skills）
- `ctx.ask({ permission: "skill", patterns: [name] })` —— 和别的工具同一权限门
- 输出包一层 XML 风格标签，例如：

```text
<skill_content name="…">
# Skill: …
…正文…
Base directory for this skill: …
<skill_files>…采样最多约 10 个附属文件…</skill_files>
</skill_content>
```

- 工具说明（`skill.txt`）：「Load when task matches skills listed in the system prompt」
- 近期 PR：执行时 **重新读盘** `SKILL.md`，避免开发期改 skill 仍返回启动缓存

**对 Nan 的启示：**  
广告列表进 `buildSystemPrompt`；一个 `skill` 工具 = `read_file(SKILL.md)` + 目录提示。权限可复用现有 ask。

### 1.3 Codex

官方概念（[Build skills](https://developers.openai.com/codex/skills) / Customization）：

- 遵循开放 **Agent Skills** 约定；repo 技能放 `.agents/skills/`
- Progressive disclosure：**开始只有 name/description/path；决定使用才加载全文**
- 可选 `agents/openai.yaml`：UI 展示名、`allow_implicit_invocation`、**MCP 依赖声明**
- 与 **Plugins** 区分：skill = 工作流本体；plugin = 分发包装（可含多个 skills + connector）

**对 Nan：** 不必做 yaml sidecar；扫 `.agents/skills/*/SKILL.md` + `.nan/skills/` 即可兼容生态。

### 1.4 DeepSeek Harness

服务缝：`ctx.skills`（`dsh-skill`）+ 文件系统 provider + 消费者 `dsh-tool-skill`。

要点：

- 发现 **只扫一层**：`…/<name>/SKILL.md` 或扁平 `….md`（**不做** 递归 `**/SKILL.md`）
- 名称强制 kebab-case
- Frontmatter：`name`/`description` 必填；`disable-model-invocation` / `user-invocable` 控制谁能触发
- **Catalog lifecycle**：每个 `agent/pre-step` 对 cwd `snapshot()` → 只含排序后的 name+description；变更则整表替换注入（不是塞进 system 大段）
- 模型面：`skill` 工具按需展开；用户面：消息里 `/name` 可直接注入全文（`disable-model-invocation` 技能的唯一入口）
- 根优先级示例：项目 `.agents/skills`（随仓）→ `~/.agents/skills`（与 Claude Code 共享）

**对 Nan：** 「catalog 作为 user-role 快照、变更才替换」比塞进 system 更利于 cache；课设可简化为 **每次 buildSystemPrompt 重扫**。

### 1.5 Skills 对照表

| | OpenCode | Codex | DeepSeek |
|--|----------|-------|----------|
| 发现 | Glob 多模式 | `.agents/skills` + plugins | 一层目录 + 多 root 优先级 |
| 广告位置 | system available_skills | 指令链 L0 | session catalog（user-role） |
| 加载工具 | `skill` | 隐式/显式 `$skill` 等 | `skill` + `/name` |
| 权限 | permission ruleset | sandbox/policy | 插件策略 |
| MCP 绑定 | 配置侧 | `openai.yaml` dependencies | 插件组合 |

---

## 2. Sub-agent / Task 委派

### 2.1 统一心智模型

```text
Parent loop
  └─ tool: task / spawn_agent / subagent
        ├─ 建 child session（parentID 链）
        ├─ 可选：裁工具、换 persona/model、限 depth
        ├─ 跑完整 agent loop（或桥到外部 CLI）
        └─ 把「最终文本 / 结构化结果」写回 parent 的 tool result
```

要解决的硬问题（三家都有）：

1. **深度上限**（防无限套娃）  
2. **工具可见性**（子 agent 往往 deny 再委派 / deny todo）  
3. **上下文隔离**（空历史 spawn vs 带父历史 fork）  
4. **取消**（父 abort → 子 cancel）  
5. **前台 vs 后台**（同步等结果 vs fire-and-forget + 完成后注入）

### 2.2 OpenCode — `task` 工具

源码要点（`packages/opencode/src/tool/task.ts`）：

**参数：**

- `description`（短标题）  
- `prompt`（子任务正文）  
- `subagent_type`（专用 agent 配置名）  
- `task_id?`（恢复同一子 session）  
- `background?`（实验开关）

**流程：**

1. 沿 `parentID` 数 depth，与 `cfg.subagent_depth`（默认 1）比较  
2. 权限：`ask` on `task` + `subagent_type`  
3. `agent.get(subagent_type)` 取子 agent 定义（工具/权限/模型）  
4. `sessions.create({ parentID, title, agent, permission })`  
5. 默认 **deny** 子 agent 的 `todowrite` 与再次 `task`（除非子配置显式允许）——避免清单打架与递归爆炸  
6. 通过 `promptOps.prompt({ sessionID: child })` 跑子循环  
7. 取最后一条 text part 作为 tool output；包在 `<task_result>` 类标签里  
8. Background：`BackgroundJob` + 完成后 **synthetic** 消息注入父 session（并严厉提示：不要 poll/sleep/重复干活）

**对 Nan MVP：**

```text
task({ prompt, description? })
  → new Session / 空 messages
  → registry = plan 或「无 write 的 explorer」或全量减 task
  → runAgentLoop(prompt, { maxTurns: 较小 })
  → return 最后 assistant 文本
  → depth 全局 ≤ 1
```

不必先做 background / 多 agent 类型表。

### 2.3 Codex — Multi-agent / `spawn_agent`

- 配置：`config.toml` 的 `[agents]`（并发线程、默认子模型、interrupt 消息等）  
- 自定义角色：`~/.codex/agents/*.toml` 或 `.codex/agents/*.toml`（`name`/`description`/`developer_instructions`，可覆盖 model、sandbox、mcp、skills）  
- 运行时：Rust `multi_agents_v2/spawn.rs` —— 新 thread、可选 fork 父历史、`SubAgentActivity` 事件  
- 另有批量：`spawn_agents_on_csv`（结构化并行 + 汇总）  
- 沙箱/审批仍走 Codex 内核路径；子角色可收紧 `sandbox_mode`

**对 Nan：** Codex 的「角色 TOML」≈ OpenCode 的 `subagent_type`；课设用 **硬编码 1～2 种**（explorer / worker）即可。

### 2.4 DeepSeek Harness — `ctx.subagents` 能力缝

文档：[Subagents and Parallelism](https://deepseekdocs.com/en/docs/features/subagent)

分层极清晰：

| 层 | 作用 |
|----|------|
| **Service** `ctx.subagents` | 统一 API：`start` / `startContinuable` / `followup` / `interrupt` / `list*` |
| **Provider** | 真正跑在哪：进程内 / 子进程 / 外桥 |
| **Consumer 工具** | `tool-subagent`（委派）、`tool-subagent-control`（续聊控制） |

**Provider 家族：**

| Provider | 位置 | 特点 |
|----------|------|------|
| `spawn` | 同进程新 Agent | 空历史；可强加 persona / toolFilter / depth / outputSchema |
| `fork` | 同进程 | 注入父已完成轮次前缀；利于「接着上下文想」 |
| `acp` | 子进程 ACP | 无强加能力；permission 自动 allow/reject |
| `claude-code` / `codex` | 桥官方 CLI | 返回最终答案；标准 preset 里委派工具默认 disabled |
| `dsh-sdk` | 子进程完整 DSH | 最重，自带 recursion budget |

One-shot vs Continuable：前者等 `run.result`；后者拿 `childId` 可多轮 followup / cold resume / `report` 回父。

**对 Nan：** 只实现 **in-process spawn**（≈ DSH `spawn` + OpenCode 前台 `task`）。fork / ACP / 外桥全部跳过。

### 2.5 Sub-agent 对照表

| | OpenCode | Codex | DeepSeek |
|--|----------|-------|----------|
| 模型面工具 | `task` | `spawn_agent` 等 | `subagent`（可改名） |
| 子身份 | `subagent_type` / Agent 配置 | agents TOML | persona + toolFilter |
| 隔离 | 新 Session + parentID | 新 Thread | 新 Agent/Session |
| 深度 | `subagent_depth` | `max_depth` / agents 配置 | header `delegationDepth` |
| 并行 | 实验 background | max concurrent threads | 多 provider + backgroundMode |
| 回传 | tool result / 后台注入 | thread 通信事件 | result / report / followup |

---

## 3. MCP（Model Context Protocol）

### 3.1 统一心智模型

```text
Config: mcpServers.{name} = { command… } | { url… }
  → Client.connect(transport)
  → tools/list  →  转成内部 ToolDefinition（常加命名空间 mcp_name_tool）
  → 模型 call  →  client.callTool(name, args)
  → 结果字符串/结构化内容 → tool message
```

MCP **不是** harness 内核；是 **工具来源插件**。本地已有 read/bash 时，MCP 主要价值是：**浏览器、DB、SaaS、公司内部 API**。

### 3.2 OpenCode

- SDK：`@modelcontextprotocol/sdk`  
- Transport：  
  - **stdio**：本地 `command` + args + env  
  - **remote**：优先 Streamable HTTP，失败回退 SSE；OAuth（含 dynamic client registration）  
- `McpCatalog.convertTool`：把 MCP inputSchema 收成对象、`additionalProperties: false`，再 `dynamicTool` 包一层  
- 生命周期：启动连接、多 server、disable 开关、timeout  
- 另有 list/read MCP resource 等辅助工具（视版本）

配置直觉（文档）：

```json
{
  "mcp": {
    "my-fs": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/data"]
    }
  }
}
```

### 3.3 Codex

- `~/.codex/config.toml` 的 `[mcp_servers]`  
- 子 agent TOML 可 **引用** 父已声明的 server（不能只在子里凭空定义）  
- Skills 可通过 `agents/openai.yaml` **声明 MCP 依赖**，安装插件时一并拉齐  
- 历史：`codex mcp-server`（把 Codex 自身暴露成 MCP）→ 转向 App Server；方向是「Agent 作为可被调用的服务」

安全：MCP server 自带文件系统/网络权限，**等于扩大攻击面**；Codex 靠 sandbox + approval 约束。

### 3.4 DeepSeek Harness

- 插件：`dsh-mcp-client` 等，把外部 MCP 工具挂进 `ctx.tools`（常命名为 `mcp_<server>_<tool>`）  
- 与 Cordis 一致：**MCP client 是插件，不是 loop 内建**  
- 配置在 profile / cordis.yml；安装插件 ≠ 启用（profile 另开）  
- 文档强调：plugin ≠ MCP server；边界要分开讲

### 3.5 MCP 对照与坑

| 主题 | 现实 |
|------|------|
| 最小可用 | stdio + tools 即可交差 |
| 真正费时 | OAuth、远程 transport 回退、Windows spawn `.cmd`、崩溃重连 |
| 权限 | 必须映射到现有 askPermission；不能「MCP 工具免审」 |
| Schema | 很多 server schema 不规范，要 normalize |
| 课设价值 | 演示「可扩展工具源」；对改代码主路径帮助有限 |

---

## 4. 三者如何拼在一起（产品视角）

```text
用户任务
  → Skills 广告命中「发 PR / 看视频 / 用公司 API」
  → skill 工具加载正文（可能要求某 MCP）
  → MCP 提供 gh / browser / db 工具
  → 重活 spawn subagent（explorer 只读 或 worker 可写）
  → 子结果摘要回父 → 父继续 / 收尾
```

DeepSeek 把这三块都做成 **可插拔 provider + consumer**；OpenCode 偏 **内建服务 + 配置**；Codex 偏 **config.toml + TOML 角色 + 沙箱**。

Nan 当前是 **单体 registry**：最顺的生长顺序是

1. Skills（只碰 prompt + 一工具）  
2. Sub-agent spawn（复用 `runAgentLoop`）  
3. MCP stdio（最后，且可永远放报告「有意延后」）

---

## 5. Nan 落地草图（学习用，非必须实现）

### 5.1 Skills（推荐课设加分项）

```text
src/skills/discover.ts   # 扫 .nan/skills、.agents/skills、可选 ~/.agents/skills
src/tools/skill.ts       # execute: 读 SKILL.md → 返回 skill_content
prompt.ts                # # Available skills\n- name: desc
```

测试：临时目录写两个 SKILL.md → prompt 含广告 → run skill → 正文出现。

### 5.2 Sub-agent（可选薄 MVP）

```text
src/tools/task.ts
  depth 检查（session 元数据或 AsyncLocalStorage）
  childRegistry = createPlanRegistry() 或去掉 task 的 agent registry
  childSession = new Session({ persist: false })
  text = await runAgentLoop(prompt, { …, tools: childRegistry, maxTurns: 15 })
  return text
```

TUI：timeline 显示 `task: description`；子事件可折叠或只显示最终 output。

### 5.3 MCP（报告可写「不做」）

若硬要骨架：

```text
依赖 @modelcontextprotocol/sdk
启动时 connect stdio servers from config
tools/list → registry.register(wrapped)
execute → client.callTool
```

Windows：优先 `shell: true` 或显式 `npx.cmd`（你们 LSP 已有教训）。

---

## 6. 参考链接

**Skills**

- OpenCode `tool/skill.ts`：https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/skill.ts  
- Codex Build skills：https://developers.openai.com/codex/skills  
- DeepSeek Skills：https://deepseekdocs.com/en/docs/features/skills  
- DSH packages/skill：https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/skill  

**Sub-agent**

- OpenCode `tool/task.ts`：https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts  
- Codex Subagents：https://developers.openai.com/codex/subagents  
- DeepSeek Subagents：https://deepseekdocs.com/en/docs/features/subagent  
- DSH subagent 子系统：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md  

**MCP**

- OpenCode MCP docs：https://opencode.ai/docs/mcp-servers/  
- OpenCode `mcp/mcp.ts`：https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/mcp/mcp.ts  
- MCP 规范：https://modelcontextprotocol.io/  

**横切**

- Codex Customization（skills+MCP+subagents 关系）：https://developers.openai.com/codex/concepts/customization  
- Nan 上下文笔记 Phase 3（薄 skills）：[`03-上下文管理调研与落地.md`](./03-上下文管理调研与落地.md)

---

## 7. 待办勾选（实现时更新）

- [x] Skills：discover + prompt 广告 + `skill` 工具 + 单测  
- [x] Skills HTTP catalog（OpenCode）：`skills.json` + cache + `skill_install`  
- [ ] Sub-agent：同步 `task` + depth=1 + 工具裁剪 + TUI 一行  
- [ ] （可选）MCP stdio 骨架 + 一个 filesystem server 演示  
- [ ] README「有意不做」：OAuth MCP、continuable 子会话、跨 CLI 桥  
