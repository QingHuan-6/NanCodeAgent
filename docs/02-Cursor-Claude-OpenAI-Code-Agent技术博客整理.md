# Coding Agent 技术博客整理（Cursor / Claude / OpenAI）

> 调研范围：Cursor、Anthropic（Claude）、OpenAI 官方及紧密相关的工程博客/文档，主题限定在 **coding agent / agent harness / context engineering**。  
> 每条均标注出处链接；文末附交叉主题索引，便于对照自研 Agent。

---

## 0. 阅读地图

三家叙事高度收敛到一句话：

> **Agent ≈ Model + Harness**  
> Harness = 指令（system/rules）+ 工具 + 上下文策略 + 权限/沙箱 +（可选）多 Agent 编排。

| 厂商 | 关键词 | 代表文章 |
|------|--------|----------|
| Cursor | Dynamic context discovery、按模型调 harness、self-summarization、Composer | [dynamic-context-discovery](https://cursor.com/blog/dynamic-context-discovery) 等 |
| Anthropic / Claude | Workflow vs Agent、context engineering、Claude Code 实践、Dynamic Workflows | [building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents) 等 |
| OpenAI / Codex | Agent loop、App Server、开放 harness、sandbox、AGENTS.md | [unrolling-the-codex-agent-loop](https://openai.com/index/unrolling-the-codex-agent-loop/) 等 |

---

## 1. Cursor

### 1.1 Agent 三要素与「按模型调 Harness」

**出处：**

- [Best practices for coding with agents](https://cursor.com/blog/agent-best-practices)  
- [Agent overview（文档）](https://cursor.com/docs/agent/overview.md)  
- [Continually improving our agent harness](https://cursor.com/blog/continually-improving-agent-harness)

**要点：**

1. Agent = **Instructions**（system + Rules）+ **Tools** + **Model**。  
2. Cursor 为每个 frontier 模型单独调教指令与工具形态——同一任务，不同模型对 `grep` vs 专用搜索工具偏好不同；有的模型需要显式「改完跑 linter」。  
3. Harness 工程像产品迭代：愿景 → 假设 → eval + 线上信号 → 改 harness。  
4. 随着模型变强：**减少静态护栏，增加动态可拉取上下文**（与 Anthropic「JIT context」同方向）。  
5. 未来重点：多 Agent 编排（派谁、怎么陈述任务、如何缝合结果）——**编排能力在 harness，不在单一模型**。

**对自研启示：** 不要假设「一套 prompt 通吃所有模型」；至少按「Claude 系 / GPT 系」分支 system prompt 或工具描述。

---

### 1.2 Dynamic Context Discovery（动态上下文发现）

**出处：** [Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery)

**核心主张：** 少把细节一次性塞进 prompt（static），多让 agent **按需拉取**（dynamic）——更省 token，也减少矛盾信息干扰。

Cursor 落地的五类「文件化」手段：

| # | 做法 | 动机 |
|---|------|------|
| 1 | 超长 tool 输出写入文件，让 agent `tail`/分段读 | 避免截断丢关键信息；减少被迫 summarization |
| 2 | 摘要后仍保留 **chat history 文件引用**，可检索补细节 | 缓解有损压缩遗忘 |
| 3 | 支持 **Agent Skills** 开放标准：名称/描述静态暴露，正文按需加载 | 能力可扩展且不胀窗 |
| 4 | MCP 工具描述同步到文件夹，prompt 只留工具名；用时再查 | A/B：调用 MCP 的 run 上约 **−46.9%** tokens |
| 5 | IDE 终端会话输出同步为文件，可 grep | 对齐 CLI agent「看得见 shell 历史」，但是动态发现 |

**设计哲学：** 「文件」是当前对 LLM 最稳的原语——比再发明一层抽象更安全。

**对自研启示：**

- Shell/MCP 大输出 → 落盘 + 返回路径，而不是塞进 messages。  
- MCP 工具很多时：先只暴露名字列表，详情懒加载。  
- Skills/规则：描述短、正文长、按需读。

---

### 1.3 Self-Summarization 与长程任务（Composer）

**出处：** [Training Composer for longer horizons](https://cursor.com/blog/self-summarization)

**要点：**

1. Composer 在 Cursor harness 里用 RL 训练，**训练时就把 compaction 编进 rollout**（compaction-in-the-loop）。  
2. 推理时：触达上下文阈值 → 插入「请总结」合成请求 → 模型在 scratch 里思考 → 产出压缩上下文（含 plan/剩余任务/已摘要次数等状态）→ 带着摘要继续。  
3. 训练信号：整条链最终 reward 回传到中间摘要 token——**好摘要被强化，丢关键信息的摘要被削弱**。  
4. 难例上常多次 self-summarize。

**对自研启示：** 即使不用自研模型，也应：

- 定触发阈值（如 80%–95% 窗口）；  
- 摘要提示词要求保留：目标、约束、已改文件、未决问题、下一步；  
- 保留「原始历史文件」指针（见 1.2）。

---

### 1.4 使用侧实践（Rules / Skills / 交互）

**出处：** [agent-best-practices](https://cursor.com/blog/agent-best-practices)、[overview](https://cursor.com/docs/agent/overview.md)

**要点摘要：**

- **Rules**：静态、每轮都在的项目约定。  
- **Skills**：动态能力包，相关才加载。  
- Agent 用搜索工具 **按需** 找「鉴权流程」等，不必用户 @ 全文件。  
- 运行中可 **queue** 消息，或 **Send now** 在下一 tool call 边界注入纠偏（不粗暴掐断）。  
- 工具：编辑、代码库搜索、终端、浏览器、提问等。

**相关扩展阅读（同站）：**

- [How we set up our cloud agent environment](https://cursor.com/blog/)（云端 agent 环境，见 Cursor blog 列表）  
- [How Cursor Router chooses the right model](https://cursor.com/blog/)（路由选模型）

---

## 2. Anthropic / Claude

### 2.1 Building Effective Agents（奠基文）

**出处：** [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)（2024-12-19）

**核心区分：**

| 类型 | 定义 |
|------|------|
| **Workflows** | LLM + 工具由**预定义代码路径**编排 |
| **Agents** | LLM **动态**决定流程与工具使用 |

**何时用 Agent：** 步骤不可预知、需模型自主决策、环境可提供 ground truth（测试、工具结果）；代价是延迟/成本/错误累积 → 要沙箱与停止条件。

**五种可组合模式：**

1. Prompt chaining（串联 + 门控）  
2. Routing（分类后分流）  
3. Parallelization（分段并行 / 投票）  
4. Orchestrator–workers（动态拆分委派，**写代码改多文件**典型）  
5. Evaluator–optimizer（生成–评审循环）

**Agent 本体：** 「带工具的 LLM 在环境反馈下循环」——实现往往很简单；难在 **工具设计（ACI）**。

**Coding 场景为何适合 Agent：** 测试可验证、可迭代、问题空间相对结构化。

**工具设计附录（极重要）：**

- 格式贴近自然语言语料（少逼模型数行号、少 JSON 转义代码）。  
- 参数命名像给初级同事写 docstring。  
- **Poka-yoke**：例如强制绝对路径，避免 cwd 漂移后相对路径写错。  
- SWE-bench 经验：优化工具比优化总 prompt 更花时间。

**原则：** 保持简单；规划过程透明；打磨 ACI。框架可起步，但要理解底层，生产环境常减抽象。

---

### 2.2 Effective Context Engineering for AI Agents

**出处：** [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

**要点：**

1. 挑战从「写完美 prompt」转向 **管理有限注意力下的上下文**。  
2. **Just-in-time**：维护轻量标识（路径、查询、链接），运行时再用工具拉取——Claude Code 对大库/大数据用 query + `head`/`tail`，避免整对象入窗。  
3. **混合策略**：`CLAUDE.md` 天真前置；`glob`/`grep` 自主探索（绕过陈旧索引）。  
4. **压缩：** 把历史交给模型摘要，保留架构决策/未解 bug/实现细节，丢掉冗余 tool 输出；再拼「压缩上下文 + 最近访问文件」。  
5. 笔记式外部记忆、子 Agent 隔离等，都是「注意力工程」手段。

**与 Cursor 对照：** Cursor 的 dynamic context discovery ≈ Anthropic 的 JIT；两边都强调「少静态、多拉取」。

---

### 2.3 Claude Code：产品级 Harness 说明

**出处：** [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)

**Agentic loop：** Gather context → Take action → Verify results（交织进行）。

**Harness 角色：** 提供工具、上下文管理、执行环境，把语言模型变成 coding agent。

**可访问面：** 项目文件、终端、git 状态、CLAUDE.md、auto memory、MCP/Skills/Subagents 等。

**上下文满时：**

- 先清旧 tool 输出，再摘要；  
- 持久规则放 CLAUDE.md，不要只活在早期对话里；  
- `/compact` 可带 focus；  
- MCP 工具定义默认可延迟加载（tool search）；  
- Subagent 在独立窗口工作，主会话只收摘要。

**安全：** Checkpoint 可撤回文件编辑；权限模式（Auto / Manual / Accept edits / Plan）。

---

### 2.4 Claude Code Best Practices

**出处：** [Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices)

**与「造 Agent」相关的实践（摘）：**

- 用 **subagents** 做调查：大量读文件不污染主对话。  
- 完成前用 **对抗式 review subagent**（新鲜上下文只看 diff + 标准）。  
- CLAUDE.md / Hooks / Skills / MCP 控制行为与扩展。  
- 提供验证手段（测试、CLI），让 agent **自闭环**。  
- 复杂任务：先 plan，再实现；人类在检查点介入。

---

### 2.5 Dynamic Workflows（编排外置到 JS）

**出处：**

- 官方文档：[Dynamic workflows](https://code.claude.com/docs/en/workflows)  
- Cookbook：[Orchestrate subagents at scale](https://platform.claude.com/cookbook/claude-agent-sdk-08-dynamic-workflows)  
- 第三方深读：[claudefa.st — How They Work](https://claudefa.st/blog/guide/development/dynamic-workflows)

**问题：** 单会话编排「几十上百个子 Agent」会撑爆上下文，且循环/分支不可靠。

**方案：**

1. Claude **生成**一段 JavaScript 编排脚本；  
2. `Workflow` runtime **隔离执行**；中间结果在脚本变量；  
3. 主会话几乎只拿**最终答案**；  
4. 原语：`agent()`、`parallel()`（屏障）、`pipeline()`（无屏障流水线）等；  
5. 可保存 `.claude/workflows/` 复跑；可强调交叉验证（多 reviewer 互证）。

**概念升级：** 默认 Claude Code = 固定 coding harness；Dynamic Workflow = **模型现场写的定制 harness**。

**对自研启示：** 中期不必上完整工作流引擎；但应理解：**编排状态用代码变量存，比塞进 LLM messages 更稳**。课设可用「主 Agent + 一次子进程摘要」模拟。

---

### 2.6 其它相关材料

- [Claude 4 / 新模型 prompting best practices](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices)（adaptive thinking、subagent 编排提示、接近窗口勿草率收工等）  
- PDF 资源：[Building Effective AI Agents — Architecture Patterns](https://resources.anthropic.com/hubfs/Building%20Effective%20AI%20Agents-%20Architecture%20Patterns%20and%20Implementation%20Frameworks.pdf)  
- PDF：[Claude Code Advanced Patterns](https://resources.anthropic.com/hubfs/Claude%20Code%20Advanced%20Patterns_%20Subagents%2C%20MCP%2C%20and%20Scaling%20to%20Real%20Codebases.pdf)

---

## 3. OpenAI / Codex

### 3.1 Unrolling the Codex Agent Loop

**出处：** [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)

**定位：** Codex CLI / Cloud / IDE 背后共用 **Codex harness**；文中拆「用户 ↔ 模型 ↔ 工具」编排。

**要点：**

- 经 **Responses API** 驱动循环；请求带 `tools`（CLI 内置 + API 侧 + 用户 MCP）。  
- Harness 职责：组上下文、流式、执行工具、把结果变回 items、决定是否继续。  
- 强调：高质量软件修改 = 模型能力 × harness 工程（安全、效率、可靠）。

（与开源仓库对照见姊妹文档 `01-开源Code-Agent技术方案整理.md` §3。）

---

### 3.2 Unlocking the Codex Harness：App Server

**出处：** [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/)

**背景：** IDE 需要与 TUI 同一套 agent loop，但不能只做简单 request/response；曾尝试 MCP 暴露 Codex，语义不够；最终 **JSON-RPC App Server**。

**Harness 不止 loop：**

1. Thread 生命周期与持久化（create/resume/fork/archive）  
2. Config / Auth（含 ChatGPT 登录）  
3. 工具执行与扩展（沙箱、MCP、skills）统一策略  

**App Server 结构：** stdio reader → message processor → thread manager → core threads。

**对话原语：**

| 原语 | 含义 |
|------|------|
| Item | 原子 I/O（消息、工具、diff、审批），started/delta/completed |
| Turn | 一次用户输入触发的工作单元 |
| Thread | 多 Turn 的持久容器 |

**双向协议：** 客户端请求 + 大量服务端通知；审批时 **服务端反向 request**，暂停 Turn 直到 allow/deny。

**客户端模式：** 本地 IDE 拉起子进程；Web 在容器内跑 App Server；TUI 计划也改为 App Server 客户端以便远程。

**集成选择：** App Server（完整）vs `mcp-server`（能力子集）vs `codex exec`（无头）vs SDK。

---

### 3.3 Codex as a Platform

**出处：** [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)

**主张：** 开放 harness，让产品把 agent **嵌入业务 UI**（运维看板、安全调查、客服控制台），而不是强迫用户进通用聊天框。

- 应用拥有：界面、业务上下文、MCP 工具、审批与系统记录。  
- Codex 拥有：agent loop、会话、流式、沙箱执行。  
- 案例模式（Relay）：选中业务对象 → 应用注入上下文 → agent 建议 → **写操作必须审批**。  
- 引用：好的 harness（保留推理、compact 等）可显著改变基准表现与 token 效率。

**对自研启示：** 作业可只做 CLI；答辩时可讲「若产品化，会把 loop 与 UI 用事件协议拆开」。

---

### 3.4 开发者文档侧：Best Practices / App Server / SDK

**出处：**

- [Codex best practices](https://developers.openai.com/codex/learn/best-practices)  
- [App Server 文档](https://developers.openai.com/codex/app-server)  
- [Codex SDK](https://developers.openai.com/codex/sdk)

**实践要点：**

- 把 Codex 当可配置队友：`AGENTS.md` 作仓库级持久指引。  
- 配置：模型、reasoning、sandbox、approval、profile、MCP。  
- MCP 拉外部系统上下文；Skills 固化重复工作流；Subagent 卸载探索/测试。  
- Sandbox 预设：`read_only` / `workspace_write` / `full_access`。

---

### 3.5 Harness Engineering（OpenAI 工程文化延伸）

**出处（OpenAI 相关转述与社区）：**

- 工程实践讨论常指向「Harness engineering: leveraging Codex in an agent-first world」（OpenAI Engineering；第三方转载如 [engineering.fyi 摘要](https://www.engineering.fyi/article/harness-engineering-leveraging-codex-in-an-agent-first-world)）  
- 外部综述：[Addy Osmani — Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/)  
- 用户侧 harness：[Martin Fowler / Birgitta — Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)

**OpenAI 内部叙事摘要（转述）：** 团队可用 Codex 大规模生成代码，人类转向 **环境设计、意图规格、反馈回路**（自定义 lint、结构测试、taste invariants、定期「垃圾回收」式重构 PR）。

**Addy Osmani 归纳的 harness 四柱：** system prompt、tools、context、subagents；行业从「LLM API」走向 **Harness-as-a-Service**。

**Fowler 文用户侧视角：** outer harness = guides（提高一次做对概率）+ sensors（廉价检测）+ 反馈闭环，减少人工审阅负担。

**Cookbook：** [Agent Improvement Loop with Traces, Evals, and Codex](https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop) — traces → feedback → evals → 再改 harness。

---

### 3.6 Agents SDK 与「Harness / Compute 分离」（边界说明）

**出处：** [Migrate from Claude Agent SDK to OpenAI Agents SDK](https://developers.openai.com/cookbook/examples/agents_sdk/migrate-from-claude-agent-sdk/readme)

**对比（产品架构层）：**

- Claude Agent SDK 模式：harness 常与沙箱工作区绑在一起。  
- 新 OpenAI Agents SDK 模式：**可信运行时拥有 loop/审批/密钥**；沙箱是可调用的 **compute 工具**。

> 课设规则通常禁止依赖 Agents SDK；此处仅作架构对照，**实现须自写 loop**。

---

## 4. 三家交叉主题对照

### 4.1 什么是 Harness？

| 来源 | 表述 |
|------|------|
| Cursor | 为每个模型编排的 instructions + tools（及上下文策略） |
| Anthropic | 工具、上下文管理、执行环境；Claude Code「包住」模型 |
| OpenAI | agent loop + 会话 + 工具策略 + 沙箱 + 审批；经 App Server 暴露 |

### 4.2 上下文：静态 vs 动态

| 策略 | Cursor | Claude | Codex |
|------|--------|--------|-------|
| 少预加载、多拉取 | Dynamic context discovery | JIT + CLAUDE.md 混合 | Shell-first + 按需读；AGENTS.md 有上限 |
| 压缩 | Summarization + history 文件 | Auto-compact + 保留近文件 | Prompt cache + `/compact` |
| 扩展能力不胀窗 | Skills / MCP 文件化 | Skills deferred / tool search | Skills + MCP 进同一策略 |

### 4.3 多 Agent

| | Cursor | Claude | Codex |
|--|--------|--------|-------|
| 方向 | Harness 负责编排多 agent | Subagents → Teams → **Dynamic Workflows（脚本编排）** | Thread/sub-agents；App Server 多线程 |
| 关键洞 | 编排在 harness | 编排可外置到 JS runtime | 产品侧用协议驱动多会话 |

### 4.4 安全与人机协同

| | Cursor | Claude | Codex |
|--|--------|--------|-------|
| 默认 | IDE 权限与模式 | Checkpoint + 权限模式 + Hooks | **内核沙箱** + 审批门 |
| 运行中纠偏 | Queue / Send now | Esc / 插入消息 | Op 中断 + 审批 RPC |

### 4.5 工具哲学（ACI）

三家一致：

1. 工具描述是 prompt 的一部分，要迭代评测。  
2. 失败输出应回到模型，形成闭环。  
3. 文件编辑最好可 diff / 可回滚（patch、checkpoint、snapshot）。

---

## 5. 对推免「自研 Coding Agent」的博客级结论清单

1. **先写通 loop，再堆框架**（Anthropic：简单可组合模式优先）。  
2. **工具接口 > 长 system prompt**（ACI / poka-yoke）。  
3. **上下文默认 JIT**：大输出落盘；规则短、细节按需读（Cursor + Anthropic）。  
4. **必须有压缩与 max_turns**（三家皆有）。  
5. **权限至少「workspace 内 + 危险操作确认」**；沙箱是加分项（Codex）。  
6. **Plan = 裁剪工具**，不单靠「请只读」prompt（与开源 OpenCode 实践一致，博客侧 Claude Plan mode 同理）。  
7. **可观测**：事件流 / transcript，便于 demo 视频与面试讲清「为何这样运转」。  
8. **按模型微调工具说明**（Cursor harness 差异化）。  
9. **验证闭环**：测试/lint 作为工具，走 Gather–Act–Verify。  
10. **不要在 messages 里硬模拟大规模编排**；需要时用子调用返回摘要（Workflows 思想的简化版）。

---

## 6. 出处链接总表

### Cursor

| 标题 | URL |
|------|-----|
| Best practices for coding with agents | https://cursor.com/blog/agent-best-practices |
| Agent overview | https://cursor.com/docs/agent/overview.md |
| Dynamic context discovery | https://cursor.com/blog/dynamic-context-discovery |
| Continually improving our agent harness | https://cursor.com/blog/continually-improving-agent-harness |
| Training Composer for longer horizons | https://cursor.com/blog/self-summarization |

### Anthropic / Claude

| 标题 | URL |
|------|-----|
| Building effective agents | https://www.anthropic.com/engineering/building-effective-agents |
| Effective context engineering for AI agents | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| Claude Code best practices | https://www.anthropic.com/engineering/claude-code-best-practices |
| How Claude Code works | https://code.claude.com/docs/en/how-claude-code-works |
| Dynamic workflows | https://code.claude.com/docs/en/workflows |
| Cookbook: Dynamic workflows | https://platform.claude.com/cookbook/claude-agent-sdk-08-dynamic-workflows |
| Claude 4 prompting best practices | https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices |
| Building Effective AI Agents (PDF) | https://resources.anthropic.com/hubfs/Building%20Effective%20AI%20Agents-%20Architecture%20Patterns%20and%20Implementation%20Frameworks.pdf |
| Claude Code Advanced Patterns (PDF) | https://resources.anthropic.com/hubfs/Claude%20Code%20Advanced%20Patterns_%20Subagents%2C%20MCP%2C%20and%20Scaling%20to%20Real%20Codebases.pdf |
| Dynamic Workflows 深读（第三方） | https://claudefa.st/blog/guide/development/dynamic-workflows |

### OpenAI / Codex

| 标题 | URL |
|------|-----|
| Unrolling the Codex agent loop | https://openai.com/index/unrolling-the-codex-agent-loop/ |
| Unlocking the Codex harness (App Server) | https://openai.com/index/unlocking-the-codex-harness/ |
| Codex as a platform | https://developers.openai.com/blog/codex-as-a-platform |
| Codex App Server docs | https://developers.openai.com/codex/app-server |
| Codex best practices | https://developers.openai.com/codex/learn/best-practices |
| Codex SDK | https://developers.openai.com/codex/sdk |
| Agent improvement loop (Cookbook) | https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop |
| Migrate Claude Agent SDK → OpenAI Agents SDK | https://developers.openai.com/cookbook/examples/agents_sdk/migrate-from-claude-agent-sdk/readme |

### 延伸（非三家官方，但直接讨论 coding agent harness）

| 标题 | URL |
|------|-----|
| Agent Harness Engineering (Addy Osmani) | https://addyosmani.com/blog/agent-harness-engineering/ |
| Harness engineering for coding agent users (martinfowler.com) | https://martinfowler.com/articles/harness-engineering.html |
| Harness engineering 摘要转载 | https://www.engineering.fyi/article/harness-engineering-leveraging-codex-in-an-agent-first-world |

---

## 7. 建议精读顺序（时间紧时）

1. Anthropic — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)（建立词汇表）  
2. Anthropic — [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)  
3. Cursor — [Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery)  
4. OpenAI — [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)  
5. OpenAI — [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)  
6. Claude Code — [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works) + [Workflows](https://code.claude.com/docs/en/workflows)  
7. Cursor — [Continually improving agent harness](https://cursor.com/blog/continually-improving-agent-harness) + [Self-summarization](https://cursor.com/blog/self-summarization)

---

*与 `01-开源Code-Agent技术方案整理.md` 配合使用：博客管「为什么」，开源管「怎么落地」。*
