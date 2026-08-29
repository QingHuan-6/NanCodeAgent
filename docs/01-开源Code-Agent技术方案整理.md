# 开源 Coding Agent 技术方案整理

> 调研范围：OpenCode、Claude Code（含可研究源码/复刻）、Codex、Pi  
> 整理目的：为自研编程智能体提供可对照的架构思路与设计决策参考  
> 说明：Claude Code 官方闭源；下文结合官方文档 + 社区反编译/研究仓库。Codex / OpenCode / Pi 为可公开阅读的开源实现。

---

## 0. 总览对照

| 维度 | OpenCode ([sst/opencode](https://github.com/sst/opencode)) | Claude Code（Anthropic 产品） | Codex ([openai/codex](https://github.com/openai/codex)) | Pi ([earendil-works/pi](https://github.com/earendil-works/pi)) |
|------|-----------------------------------------------------------|-------------------------------|--------------------------------------------------------|--------------------------------------------------------------|
| 开源状态 | 完全开源 | **闭源产品**；npm 包可研究，另有 claw-code 等复刻 | 开源（Rust 核心） | 完全开源（MIT） |
| 语言/运行时 | TypeScript + Bun | TypeScript / Bun → Node bundle | Rust（~84 crates）+ 多端客户端 | TypeScript monorepo |
| 核心哲学 | 生产级「微 OS」：权限、事件总线、多 Agent | Harness 包模型：agentic loop + 工具 + 上下文 | Harness 与 UI 分离；内核级沙箱 | **极简可扩展**：默认 4 工具，用 Package 扩展 |
| Agent 循环 | `SessionPrompt.loop()` | `query` / tool_use 循环 | Submission/Event + Turn | `agentLoop` / `Agent.prompt` |
| 权限/安全 | Permission Ruleset + BashArity | 权限模式 + Hooks（应用层） | Landlock / Seatbelt / 受限 Token | `beforeToolCall` / 用户扩展 |
| 多 Agent | `task` 委派 + 按工具裁剪的子 Agent | Subagents / Agent Teams / Dynamic Workflows | Thread + sub-agents | 故意不做；用 Package 自行加 |
| 上下文 | Compaction Agent 压缩 | 自动 compact + CLAUDE.md + JIT 检索 | Prompt cache + `/responses/compact` | `transformContext` 钩子 |
| Provider | Vercel AI SDK，25+ / models.dev | Claude 系为主 | Responses API（可 --oss） | `@earendil-works/pi-ai` 统一多厂商 |
| UI 形态 | TUI / Web / Desktop(Tauri) | CLI / Desktop / IDE / Web / CI | TUI / Exec / App Server / IDE | CLI + pi-tui |

**共性（几乎所有生产级 coding agent）：**

1. **Agent = Model + Harness**：模型只负责推理与 tool call；读写文件、执行命令、权限、会话、终止条件都在本地 harness。
2. **核心循环**：`messages → LLM(stream) → tool_calls? → 本地执行 → tool_result 回写 → 再调 LLM`，直到无 tool call 或显式停止。
3. **工具是「手脚」**：能力边界由工具可见性决定，而不是仅靠 prompt「请不要写文件」。
4. **上下文会爆**：都要有压缩 / 摘要 / JIT 拉取 / 子 Agent 隔离上下文。
5. **安全是一等公民**：审批门、沙箱、路径限制、危险命令分级。

---

## 1. OpenCode

### 1.1 项目定位与入口

- 官网：[https://opencode.ai/](https://opencode.ai/)
- 仓库：[https://github.com/sst/opencode](https://github.com/sst/opencode)
- 定位：开源 AI coding agent，覆盖终端、IDE、桌面；强调隐私（不上传代码到自家服务）、多模型、LSP、多 Session。

### 1.2 技术栈与仓库结构

| 层 | 技术 | 意图 |
|----|------|------|
| Runtime | Bun | 启动快、原生 SQLite |
| Monorepo | Turborepo | 多包协作 |
| UI | SolidJS（TUI 用 @opentui/solid） | 细粒度响应式，适合 TUI |
| AI | Vercel AI SDK v5 | 统一 25+ Provider 流式接口 |
| 持久化 | Drizzle + SQLite | 轻量、类型安全 |
| 校验 | Zod | Tool/事件 schema |
| Desktop | Tauri v2 | 轻量壳 |

核心逻辑集中在 `packages/opencode/src/`：Agent 调度、事件总线、权限、存储、HTTP Server——相当于一个「微型操作系统」。

架构深读参考：

- [Dissecting OpenCode: Architecture Deep Dive](https://zengineer.blog/blog/tech/opencode-architecture-deep-dive-en/)
- [Inside OpenCode（Medium）](https://medium.com/@gaharwar.milind/inside-opencode-how-to-build-an-ai-coding-agent-that-actually-works-28c614494f4f)
- Effect 改造说明：[packages/opencode/specs/effect/guide.md](https://github.com/sst/opencode/blob/main/packages/opencode/specs/effect/guide.md)

### 1.3 启动与进程模型

```
opencode CLI
  → yargs + middleware（日志、环境、DB migration）
  → 默认 TUI：主线程只做渲染/输入
  → Worker Thread：HTTP Server + LLM 流式 + 文件/MCP I/O
  → 主线程 ↔ Worker：RPC；事件经 GlobalBus 转发
```

**设计点**：重 I/O 与 UI 分离，避免工具执行卡死终端。

### 1.4 Agent 系统（能力由权限裁剪，而非仅靠 Prompt）

内置 Agent（职责 + 工具可见性）：

| Agent | 角色 | 工具范围 |
|-------|------|----------|
| build | 默认：实现与修改 | 几乎全部 |
| plan | 只分析不改代码 | 只读 + plan 文件 |
| general / explore | 子任务 / 探索 | 受限搜索类 |
| compaction / title | 内部：压缩、标题 | 内部 |

要点：

- **plan 模式不靠「请勿改文件」prompt**，而是从 tool list 去掉写工具——模型看不到就无法调用。
- 通过 `task` 工具委派子 Agent（独立 Session），可递归，但每层有自己的 Permission Ruleset。
- System prompt 按 Provider 定制（Anthropic / GPT / Copilot / Gemini 等），并注入 cwd、Git 状态、OS、日期等运行时上下文。

### 1.5 工具系统

工具抽象大致为：`id` + Zod parameters + `execute` → `{ title, output, metadata, attachments? }`；**懒初始化**，首次使用才 `init()`。

常见内置工具：

- 文件：`bash`、`read`、`write`、`edit`、`apply_patch`
- 搜索：`glob`、`grep`、`websearch`、`codesearch`、`webfetch`
- 协作：`task`、`question`、`skill`、`batch`（并行多工具）、`todowrite`、`lsp`

**模型感知过滤**：例如 GPT 系倾向 `apply_patch`，其它模型倾向 `edit`/`write`。

**Edit 的 9 层回退匹配**（从严格到宽松）：精确 → 行 trim → 块锚点+编辑距离 → 空白归一 → 缩进灵活 → 转义归一 → …  
解决 LLM 字符串替换「差一点对不上」的核心痛点。

### 1.6 核心循环与终止 / 防死循环

心跳在 `SessionPrompt.loop()`（`src/session/prompt.ts`）：

1. 解析用户输入（文本、file://、附件、MCP resource）
2. 解析当前 Agent + Model 可用工具
3. `LLM.stream()`（AI SDK）
4. 处理 text / reasoning / tool-call / finish-step
5. 无更多 tool calls → 结束；需压缩 → compaction；否则下一轮

**Doom loop**：连续 ≥3 次「同工具 + 同参数」则告警，打断无意义重试。

**Compaction**：专用 compaction Agent 压缩历史，插入 CompactionPart，替换冗长历史。

### 1.7 Provider / MCP / 权限 / 存储 / 事件

- **Provider**：AI SDK `LanguageModelV2`；`transform.ts` 做各家消息清洗；模型目录来自 models.dev（本地路径 / 编译快照 / 远程定时更新）。
- **MCP**：Streamable HTTP → SSE → Stdio 回退；MCP 工具转成与内置工具同形态。
- **权限**：allow / deny / ask；多层规则合并；Bash 用 **BashArity** 做细粒度（如 `git status` vs `git push`）。
- **存储**：SQLite + WAL；Session → Message → Part；事务后 side-effect 发事件。
- **事件总线**：业务 → Bus.publish → Instance 订阅者 + GlobalBus → Worker → RPC → TUI。

### 1.8 可借鉴点（做课设 Agent）

1. **用工具可见性实现 Plan/Build**，比 prompt 更硬。  
2. **Edit 多层回退**显著提升改文件成功率。  
3. **Doom loop 检测**是必做安全网。  
4. **事件驱动**便于 CLI/Web 共用一套核心。  
5. **Git/Snapshot 撤销**增强可信度（内部快照 + patch）。

---

## 2. Claude Code（闭源产品 + 可研究材料）

### 2.1 官方定位（非开源）

- 文档入口：[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- Best practices：[Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- Dynamic Workflows：[Workflows 文档](https://code.claude.com/docs/en/workflows)

**Claude Code = Claude 模型 + Agentic Harness**（工具、上下文管理、执行环境）。官方不开放完整源码。

### 2.2 官方公开的技术方案思路

#### Agentic loop：Gather → Act → Verify

三阶段交织：

1. **Gather context**：读文件、grep/glob、问用户  
2. **Take action**：编辑、bash、写文件  
3. **Verify**：跑测试、看类型错误、再修正  

人可随时打断（Esc / 插入纠偏消息）。循环由模型决定下一步，Harness 提供工具与环境。

#### 工具五类

| 类别 | 能力 |
|------|------|
| File ops | Read / Edit / Write / 重组 |
| Search | Glob / Grep / 语义探索 |
| Execution | Shell / 测试 / git |
| Web | Search / Fetch |
| Code intelligence | LSP 类（插件） |

另有：Subagent、AskUserQuestion、MCP、Skills 等编排工具。

#### 上下文工程（官方工程博客高度一致）

来源：[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

- **Just-in-time**：少预塞上下文；用路径/查询标识符，运行时再拉。  
- **混合**：`CLAUDE.md` 静态注入 + glob/grep 动态发现。  
- **Compact**：历史摘要 + 保留最近若干文件；避免一刀切截断。  
- **Subagent**：探索类任务放到独立上下文，主会话只拿摘要——防止「读一堆文件污染主窗口」。

#### 会话与安全

- 会话 JSONL 落盘 `~/.claude/projects/`；支持 resume / fork；编辑前 checkpoint。  
- 权限模式：Auto / Manual / Accept edits / Plan 等。  
- Hooks：PreToolUse 等生命周期，应用层策略（对比 Codex 的内核沙箱）。

#### 多 Agent 演进

1. **Subagents**：`Agent` 工具 spawn 子循环，独立工具集与权限，父级只收最终结果。深读：[Ch 8 Spawning Sub-Agents](https://claude-code-from-source.com/ch08-sub-agents/)  
2. **Agent Teams**：多 Agent 协作（文档/产品功能）。  
3. **Dynamic Workflows**：Claude **写一段 JS 编排脚本**，由独立 runtime 跑；循环/分支/中间结果在脚本变量里，**不进主上下文**；可保存到 `.claude/workflows/` 复跑。文档：[code.claude.com/docs/en/workflows](https://code.claude.com/docs/en/workflows)

设计洞察：**编排从「模型每轮决定」部分外置到「确定性脚本」**，解决超大规模并行与上下文膨胀。

### 2.3 社区源码研究（非官方开源）

| 材料 | 链接 | 用途 |
|------|------|------|
| npm 反编译分析 | [aidada/claude-code-source-code](https://github.com/aidada/claude-code-source-code) | 架构、工具、12 层 harness 机制 |
| 合集 | [chauncygu/collection-claude-code-source-code](https://github.com/chauncygu/collection-claude-code-source-code) | 多份研究/复刻索引 |
| DeepWiki | [anthropics/claude-code System Architecture](https://deepwiki.com/anthropics/claude-code/1.1-system-architecture) | 组件关系图 |
| Claw Code 复刻 | [instructkr/claw-code](https://github.com/instructkr/claw-code)（见 Eigent 介绍） | Rust/Python 干净室式研究实现 |

从反编译分析可见的核心结构：

```
Entry (cli / REPL / QueryEngine)
  → query() 主循环（极大文件）
  → StreamingToolExecutor（可并行工具）
  → canUseTool（hooks + rules + UI）
  → tool.call → tool_result → 再调 API
```

工具接口能力位：`isConcurrencySafe` / `isReadOnly` / `isDestructive` / `interruptBehavior` 等——**工具元数据驱动调度与权限**。

最小循环（研究仓库归纳）：

```
messages → Claude API → stop_reason == tool_use?
  yes → execute → append tool_result → loop
  no  → 返回文本结束
```

外围 harness：权限、流式、并发、compact、sub-agent、持久化、MCP。

### 2.4 Anthropic 通用 Agent 模式（与 Claude Code 同源思想）

来源：[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

- Workflow vs Agent：预定义路径 vs 模型动态控权。  
- 模式：Prompt chaining / Routing / Parallelization / Orchestrator-workers / Evaluator-optimizer。  
- Coding agent 适配：**可验证（测试）+ 环境反馈闭环**。  
- **ACI（Agent-Computer Interface）**：工具描述与参数设计要像 HCI 一样打磨；绝对路径优于相对路径等。

### 2.5 可借鉴点

1. 循环即 **Gather–Act–Verify**，显式「验证」步骤。  
2. Subagent 做 **上下文隔离**，主会话保持干净。  
3. CLAUDE.md / Rules = 静态契约；Skills = 按需加载。  
4. Dynamic Workflows：**大规模编排用代码，不用上下文里「记循环变量」**。  
5. 工具参数要「防呆」（poka-yoke）。

---

## 3. Codex（OpenAI 开源）

### 3.1 项目与文档入口

- 仓库：[https://github.com/openai/codex](https://github.com/openai/codex)
- 官方：Agent loop 拆解 — [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
- 官方：App Server — [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)
- 官方：平台化 — [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)
- 社区深读：  
  - [codex-rs 架构](https://codex.danielvaughan.com/2026/03/28/codex-rs-rust-rewrite-architecture/)  
  - [Agentic loop 到代码级](https://codex.danielvaughan.com/2026/04/07/codex-cli-agentic-loop-internals/)  
  - DeepWiki：[Architecture Overview](https://deepwiki.com/openai/codex/1.3-architecture-overview)

### 3.2 总体架构：Core + 多前端

```
┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│ codex-tui   │  │ codex-exec  │  │ app-server   │  │ mcp-server  │
│ (交互终端)   │  │ (无头/CI)   │  │ (IDE/JSON-RPC)│  │ (被编排)    │
└──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘
       └────────────────┴───────────────┴──────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │    codex-core     │  ThreadManager / Session / Turn
                    │  ToolRouter / MCP │  ContextManager / Sandbox
                    └───────────────────┘
```

早期 TypeScript → 现以 **Rust (`codex-rs`)** 为主：零依赖安装、原生安全绑定、无 GC、可对外 wire protocol。

### 3.3 Submission / Event 解耦

- 客户端：`submit(Op)`（用户回合、审批、中断…）  
- 引擎：`next_event()` → `EventMsg`（文本 delta、工具状态、审批请求…）  
- `submission_loop` 在独立 Tokio 任务，状态变更线性化。

**收益**：TUI / Exec / App Server / 远程客户端共用同一事件流。

### 3.4 Thread / Turn / Item

| 原语 | 含义 |
|------|------|
| Thread | 持久会话（SQLite / rollout 文件），可 resume/fork/archive |
| Turn | 一次用户输入触发的完整 agent 工作单元 |
| Item | Turn 内原子 I/O：user/agent 消息、工具执行、diff、审批等；有 started/delta/completed 生命周期 |

App Server 把这些做成 **双向 JSON-RPC**（JSONL over stdio / ws / unix），IDE 与桌面都当「客户端」。

### 3.5 Prompt 组装与 Responses API

顺序刻意固定以最大化 **prompt cache**：

1. System  
2. Tools schema  
3. Developer instructions（config / `AGENTS.md` / skills，有大小上限）  
4. 完整对话历史  

刻意 **不用** `previous_response_id`：每次请求自包含，利于企业 **ZDR（零数据保留）**。

工具来源三类：CLI 内置、Responses API 侧工具、用户 MCP。

### 3.6 ToolRouter 与执行后端

1. **Shell / UnifiedExec**：PTY、长进程；偏好 shell-first（cat/grep/测试），文件变更走专用通道。  
2. **apply_patch**：结构化补丁，而非任意 shell 写文件。  
3. **MCP**：`McpConnectionManager`，与内置工具同一审批/沙箱策略。

### 3.7 审批门 + 内核级沙箱（Codex 最大特色）

**AskForApproval**：UnlessTrusted / OnRequest / Never；用户侧 Auto / Read-only / Full Access。

**沙箱（内核层，非仅应用层 hooks）**：

| 平台 | 机制 |
|------|------|
| Linux | Landlock（+ 可选 Bubblewrap） |
| macOS | Seatbelt / sandbox-exec |
| Windows | 受限 Token / WSL2 等路径 |

**arg0 自调用**：同一二进制以 `codex-linux-sandbox` 名再 exec，进入沙箱模式跑命令。

策略：`DangerFullAccess` / `WorkspaceWrite` / `ReadOnly`。

### 3.8 上下文：Cache + Compact

- 静态前缀稳定 → 高 cache hit（延迟与成本显著下降）。  
- 接近窗口上限 → 阻塞写工具 → 调 `/responses/compact` → 服务端摘要（可加密 blob）→ 重建：初始 prompt + 近消息 + summary。

错误恢复：工具失败结果回写 history，由模型自行改策略（ReAct），而非硬编码重试（compact 失败有 backoff）。

### 3.9 平台化集成选择

| 方式 | 场景 |
|------|------|
| `codex exec` | CI、一次性任务 |
| Codex SDK | 应用内程序化控制 |
| App Server | 产品内嵌：会话、流式、审批、多线程 |
| `codex mcp-server` | 被其它 Agent 当工具调用 |

### 3.10 可借鉴点

1. **UI 与 Core 用队列解耦**（便于作业：CLI 先做，以后加 Web）。  
2. **apply_patch 优于自由写文件**（可审计、可 diff）。  
3. 安全分级：至少 WorkspaceWrite + 审批；有余力再做 OS 沙箱。  
4. Prompt 前缀稳定，利于缓存与成本。  
5. Thread/Turn/Item 原语清晰，适合做日志回放与演示视频。

---

## 4. Pi（earendil-works/pi）

### 4.1 项目定位

- 仓库：[https://github.com/earendil-works/pi](https://github.com/earendil-works/pi)  
- Coding agent 包：[packages/coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)  
- Agent 运行时 README：[packages/agent README（raw）](https://raw.githubusercontent.com/earendil-works/pi/main/packages/agent/README.md)

口号：**极简终端 harness**——默认够用，用 Extensions / Skills / Prompt Templates / Themes / **Pi Packages** 扩展，而不是把所有功能塞进核心。

### 4.2 包分层

| Package | 职责 |
|---------|------|
| `@earendil-works/pi-ai` | 统一多厂商 LLM API / 流式 |
| `@earendil-works/pi-agent-core` | Agent 循环、工具执行、状态、事件 |
| `@earendil-works/pi-coding-agent` | 交互式 coding CLI |
| `@earendil-works/pi-tui` | 差分渲染 TUI |
| `@earendil-works/pi-telemetry` | 厂商中立遥测契约 |

默认只给模型 **四个工具**：`read`、`write`、`edit`、`bash`。  
**故意不做**内置 subagent / plan mode——需要则装第三方 package 或让 pi 帮你写扩展。

### 4.3 Agent 核心设计（极适合课设对照）

#### AgentMessage vs LLM Message

- 应用层可有自定义消息类型（declaration merging）。  
- 每次调模型前：`transformContext`（裁剪/注入）→ `convertToLlm`（滤掉 UI-only）→ 真正的 LLM messages。

#### 事件序列（便于做 TUI）

`agent_start` → `turn_start` → `message_*` →（可选）`tool_execution_*` → `turn_end` → … → `agent_end`

有工具时：assistant(toolCall) → tool 执行 → toolResult message → 下一 turn 再调 LLM。

#### 工具执行模式

- 默认 **parallel**：预检串行，允许的工具并发执行；`tool_execution_end` 按完成序，持久化 toolResult 仍按 assistant 源序。  
- 可 `sequential`；单工具可标 `executionMode: "sequential"` 迫使整批串行。

#### Hooks

- `beforeToolCall`：可 block + `terminate`  
- `afterToolCall`：改写结果 / terminate  
- `shouldStopAfterTurn`：turn 结束后优雅停（例如触发 compact），不中断正在跑的工具  

整批工具结果若都 `terminate: true`，可跳过自动 follow-up LLM 调用。

#### Steering / Follow-up

- **steer**：工具跑着时插入用户纠正，本 turn 工具跑完再注入。  
- **followUp**：本该结束时再塞后续任务。

### 4.4 扩展生态

- Skills / Extensions / Themes / Prompt Templates  
- `pi install npm:...` 或 `git:...`  
- 清单：`package.json` 的 `pi` 字段或约定目录  

文档：[packages.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)

### 4.5 可借鉴点（课设「从简到繁」首选）

1. **最小可运行循环**：4 工具 + `agentLoop` 就能交作业。  
2. **消息双层模型**（AgentMessage / LLM Message）利于日志 UI。  
3. **beforeToolCall** 实现权限，无需一上来做 OS 沙箱。  
4. **扩展点优先于内置功能膨胀**——与推免「功能繁简不限」完全契合。  
5. 事件流设计直接可做流式终端演示。

---

## 5. 四者横向：设计决策地图

### 5.1 循环与终止

| 系统 | 终止条件 | 防失控 |
|------|----------|--------|
| OpenCode | 无 tool_calls；用户中断 | Doom loop 检测 |
| Claude Code | stop_reason 非 tool_use；权限拒绝仍可继续 | compact thrash 检测；权限；Hooks |
| Codex | Turn 完成；审批拒绝；中断 Op | 沙箱 + 审批；写工具在 compact 前阻塞 |
| Pi | 无工具且无 queue；`shouldStopAfterTurn`；terminate 提示 | beforeToolCall block |

### 5.2 改文件策略

| 系统 | 策略 |
|------|------|
| OpenCode | edit 多层模糊匹配 + write + apply_patch（按模型） |
| Claude Code | FileEdit 字符串替换 + FileWrite；checkpoint |
| Codex | **apply_patch 优先**，约束 shell 乱写 |
| Pi | 简单 write/edit（可扩展） |

### 5.3 上下文策略

| 系统 | 策略 |
|------|------|
| OpenCode | Compaction Agent |
| Claude Code | JIT + CLAUDE.md + auto compact + subagent 隔离 + Workflows 外置编排 |
| Codex | Prompt cache + 服务端 compact |
| Pi | `transformContext` 用户自管 |

### 5.4 安全模型光谱

```
弱 ─────────────────────────────────────────────── 强
Pi(hooks) → OpenCode(权限规则) → Claude(权限+hooks) → Codex(内核沙箱)
```

### 5.5 扩展模型

- OpenCode：插件 + MCP + 多 Agent  
- Claude Code：Skills + MCP + Hooks + Subagents + Workflows  
- Codex：Skills + MCP + App Server 嵌入产品  
- Pi：**Packages 一等公民**，核心保持瘦

---

## 6. 对「自研编程智能体」的建议抽取

若目标是推免课设级自研 agent（禁止 LangChain 等框架，允许原生 tool calling）：

**MVP（对齐 Pi + 最小 Claude 循环）**

1. 本地实现：`read_file` / `write_file` / `edit_file` / `run_shell`  
2. OpenAI 兼容 API + 原生 tools  
3. while 循环：解析 tool_calls → 本地执行 → 追加 tool 消息  
4. `max_turns` + 连续失败检测  
5. 路径限制在 workspace 内；危险命令 ask  

**进阶（对齐 OpenCode / Claude）**

6. Plan 模式：去掉写工具  
7. 简单 compact（摘要旧消息）  
8. 会话 JSONL 持久化 + 回放  
9. 可选：子任务工具（新 messages 列表跑完只返回摘要）  

**加分（对齐 Codex 思路）**

10. apply_patch 式编辑  
11. Submission/Event 分离（方便以后加 UI）  
12. AGENTS.md / 项目规则注入  

---

## 7. 主要出处链接汇总

### OpenCode

- https://opencode.ai/  
- https://github.com/sst/opencode  
- https://zengineer.blog/blog/tech/opencode-architecture-deep-dive-en/  
- https://medium.com/@gaharwar.milind/inside-opencode-how-to-build-an-ai-coding-agent-that-actually-works-28c614494f4f  
- https://github.com/sst/opencode/blob/main/packages/opencode/specs/effect/guide.md  
- https://guidefari.com/effect-at-opencode/  

### Claude Code / Anthropic

- https://code.claude.com/docs/en/how-claude-code-works  
- https://code.claude.com/docs/en/workflows  
- https://www.anthropic.com/engineering/building-effective-agents  
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents  
- https://www.anthropic.com/engineering/claude-code-best-practices  
- https://github.com/aidada/claude-code-source-code  
- https://github.com/chauncygu/collection-claude-code-source-code  
- https://claude-code-from-source.com/ch08-sub-agents/  
- https://deepwiki.com/anthropics/claude-code/1.1-system-architecture  
- https://www.eigent.ai/blog/claw-code  

### Codex / OpenAI

- https://github.com/openai/codex  
- https://openai.com/index/unrolling-the-codex-agent-loop/  
- https://openai.com/index/unlocking-the-codex-harness/  
- https://developers.openai.com/blog/codex-as-a-platform  
- https://developers.openai.com/codex/app-server  
- https://codex.danielvaughan.com/2026/03/28/codex-rs-rust-rewrite-architecture/  
- https://codex.danielvaughan.com/2026/04/07/codex-cli-agentic-loop-internals/  
- https://deepwiki.com/openai/codex/1.3-architecture-overview  

### Pi

- https://github.com/earendil-works/pi  
- https://github.com/earendil-works/pi/tree/main/packages/coding-agent  
- https://raw.githubusercontent.com/earendil-works/pi/main/packages/agent/README.md  
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md  

---

*文档生成说明：基于公开仓库 README/源码结构说明、官方工程博客与高质量第三方架构分析整理；Claude Code 以官方文档为准，源码细节标注为社区研究材料。*
