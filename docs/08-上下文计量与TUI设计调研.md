# 08 — 上下文计量 + TUI 设计调研

> 调研日期：2026-08-30  
> 目的：学开源 coding agent **怎么知道上下文用了多少**，以及 **TUI 如何呈现回答 / 工具 / 交互**；对照 Nan 缺口，给出可落地优先级。  
> 相关：[`03-上下文管理`](./03-上下文管理调研与落地.md)、[`07-Memory`](./07-Memory调研.md)

---

## A. 上下文怎么「确定」

### A.0 核心结论

成熟产品**几乎从不**每轮本地跑完整 tokenizer 来做压缩决策（太慢、和网关不一致）。主流是：

```text
API 返回的 usage（精确锚点）
  + 锚点之后新消息的粗估（chars÷N）
  = 当前上下文占用估计
  → 和「窗口 − 输出预留缓冲」比较 → 触发各层压缩
```

Nan 现状（已落地）：API `usage` 锚点 + rough；auto-compact 按 token 预算；footer/`/context` 可见。Prune/microcompact 仍可用 char 软预算做层内截断。

---

### A.1 Claude Code（参考实现最清晰）

资料：[how-claude-code-works · context engineering](https://github.com/Windy3f3f3f3f/how-claude-code-works/blob/main/en/docs/03-context-engineering.md)、[Inside Claude Code · compaction](https://y-agent.github.io/inside-claude-code/04-context-compaction.html)、官方 `/context`

**计量函数思想（`tokenCountWithEstimation`）：**

1. 从后往前找最近一条带 **server `usage`** 的 assistant 消息  
2. 以该次 `input_tokens`（+ cache 相关字段，视实现）为**锚点**  
3. 锚点之后的新消息（通常是刚产生的 tool results）用 **rough 估计**：普通文本 ≈ `chars/4`，稠密 JSON 更保守 ≈ `chars/2`  
4. 整段都没有 usage（刚开聊）→ 全程 rough  

原则：**压缩决策绝不额外打 tokenizer API**，避免延迟干扰。

**预算怎么切：**

```text
有效历史预算 ≈ context_window − system − tools − reminders − 输出预留缓冲
触发 auto-compact ≈ 有效窗口的 ~83–85%（留足 completion）
```

UI：`/context` 按类别拆解；statusline 可显示 `used_percentage`；`/cost` 看累计。

---

### A.2 Codex

- 依赖 Responses / Chat Completions 的 **usage**；爆窗走服务端或本地 compact  
- TUI（ratatui）侧关心的是 transcript 渲染，token 决策在 core agent loop  
- 有 prompt cache 时，计量还要理解 cache read/write（和 Claude 类似）

---

### A.3 OpenCode / Pi

- 压缩边界、preserve prefix 等偏 **session compaction 策略**  
- 计量同样倾向 **usage + 估计**；具体实现随 provider 适配层变化  
- 强调 compact 后 **规则/AGENTS 不能丢**（见 issue 系列）

---

### A.4 Nan 缺口 → 建议落地

| 项 | Nan 现在 | 建议（课设可做） |
|----|----------|------------------|
| 锚点 | ✅ Session `lastUsage` + assistant index | 每次 LLM 完成后记录 |
| 粗估 | ✅ `chars/4`（JSON denser `/2`） | 与锚点相加 |
| 窗口大小 | ✅ `NAN_CONTEXT_TOKENS`（默认 128k） | 按 model 表可选 |
| 缓冲 | ✅ `NAN_CONTEXT_RESERVE`（默认 8k）+ ratio 0.85 | 显式输出预留 |
| 可见性 | ✅ footer `ctx ~N%` · `/status` · `/context` | — |

**伪代码（对齐 Claude）：**

```ts
function estimateContextTokens(messages, lastUsage?): number {
  if (lastUsage) {
    return lastUsage.prompt_tokens
      + roughTokens(messagesAfterAnchor);
  }
  return roughTokens(allNonSystem);
}
// trigger when estimate > contextWindow - outputReserve
```

Nan 的 `LlmClient` **已经**能拿 `usage`（含 stream `include_usage`）——缺的是**接到 session 与 compact 触发器上**。

---

## B. TUI 设计（回答 · 工具 · 交互）

### B.0 统一心智模型

产品级 TUI 几乎都是：

```text
┌─ Transcript（可滚动、可折叠）─────────────────┐
│  User / Assistant(MD流式) / Tool rows / …      │
│  Reasoning（可选折叠）                          │
└────────────────────────────────────────────────┘
┌─ Live strip（spinner / 正在跑的 tool）─────────┐
└────────────────────────────────────────────────┘
┌─ Composer（多行、历史、/ 与 @）────────────────┐
│  status: model · ctx% · mode · cost?           │
└────────────────────────────────────────────────┘
```

数据层与渲染层分离：**事件流 → message parts 模型 → 组件**。  
OpenCode：`message.part.updated` + coalesce；Codex：`HistoryCell` + `active_cell` 直播尾。

---

### B.1 大模型回答怎么展示

| 产品 | 做法 |
|------|------|
| **OpenCode** | OpenTUI `<markdown>`：conceal 标记、流式按 **block** 增量更新；thinking 应用 markdown 而非 code stream（否则一字一行） |
| **Codex** | pulldown-cmark → ratatui Line；流式只 commit **完整逻辑行**，避免半截 MD |
| **Claude Code** | Ink + MD→ANSI；Output Styles 控语气；statusline 可挂成本/上下文 |
| **Nan** | Ink + 自研轻量 MD；流式整段 `streamBuffer` 再 parse；无 thinking 分区；无滚动视口 |

**可学要点：**

1. **流式 MD 按块/按完整行提交**，不要每个 delta 全量重 parse 乱闪  
2. **conceal**：用户看见排版，不看见 `**`  
3. Assistant 与 tool **交错时间线**（Nan 已对齐事件序）  
4. Reasoning / thinking **单独样式 + 默认可折叠**

---

### B.2 工具怎么展示

| 产品 | 做法 |
|------|------|
| **OpenCode** | `InlineToolRow`：pending / running / done；标题短（动词+对象）；详情可展开；子 agent 有独立会话视图 |
| **Codex** | 工具可合并为 exec group；`active_cell` 原地更新；Ctrl+T overlay 看完整 transcript + live tail |
| **Claude** | 活动日志式一行；权限弹层；文件编辑有 diff 感 |
| **Nan** | `ToolCard` 活动日志 + Ctrl+O 展开（40 行帽）+ DiffBlock；子 agent 前缀 `explorer.*` |

**可学要点：**

1. **默认一行完成态**（Searched · 15 matches），详情按需  
2. **运行中**：spinner + 进行时标签；完成后改完成时  
3. **并行工具**：保持助手发出的顺序；结束事件可乱序到达（Nan tool-runner 已类似）  
4. **权限**：不仅 y/n，可 session allow / 预览参数（Nan 仅 y/n）  
5. **可复制 / 打开文件 / 在编辑器打开**（产品常见，Nan 无）

---

### B.3 交互完整性清单

| 交互 | OpenCode/Claude/Codex 常见 | Nan |
|------|---------------------------|-----|
| 流式回答 | ✅ | ✅ |
| Steer / 插话 | ✅ | ✅ Enter |
| Abort | ✅ | ✅ Esc |
| Slash 命令 | ✅ 丰富 | ✅ 基础 |
| 输入历史 ↑ | ✅ | ❌ |
| 多行编辑 / `$EDITOR` | ✅ | 弱（ctrl+j） |
| `@` 文件 / 补全 | ✅ | ❌ |
| Transcript 滚动 / PgUp | ✅ 应用内视口 | ✅ **OpenTUI** sticky ScrollBox（与 OpenCode 同库） |
| Resume 重建 UI 时间线 | ✅ | ✅ |
| 上下文 % / 费用 | ✅ | ✅ ctx% |
| Todo 条 | 有的有 | ✅ |
| ask_user | 有的有 | ✅ |
| 权限分级 | ✅ | 仅二元 |
| 主题 / 无障碍 | 部分 | 极简 |

**滚动说明：** Nan TUI 已迁到 **OpenTUI**（`@opentui/react` + sticky `scrollbox`），与 OpenCode 同一渲染工具包；界面与 agent 逻辑仍是自研，未嵌 OpenCode 产品壳。

---

### B.4 渲染性能（开源踩坑）

- 流式事件 **coalesce / 节流**，避免每 token 全树 reconcile（OpenCode PR）  
- Ink `Static`：已完成消息固定，只重绘底部 live 区（OpenCode Ink 重写 epic）  
- Codex：active cell **原地 mutate + revision**，overlay 缓存 live tail  
- 半截 markdown / 半截表格：streaming 标志位，完成后再 finalize（OpenCode tables）

Nan：每次 timeline 增长整页重绘倾向强 → 长会话会卡；课设可先做 **Static 分离 completed vs live**。

---

## C. Nan 对照与建议优先级

### C1. 上下文计量（建议先做，收益高）

1. **Session 记录 lastUsage**（从 `ChatResult.usage`）  
2. **`estimateContextTokens()`** = usage 锚点 + 后续 rough  
3. **`/status` 显示** `ctx ~xx% (est)`  
4. Auto-compact 阈值从「chars/120k」改为「tokens / (window − reserve)」  
5. （可选）`/context` 粗分：system / tools schema / history / memory  

### C2. TUI（建议按体验排序）

| 优先级 | 项 | 说明 |
|--------|-----|------|
| P0 | Footer：model + mode + ctx% | 和计量一起上 |
| P0 | Resume 重建 timeline | 否则「恢复了但屏幕空」 |
| P1 | Ink `Static` 固定已完成行 | 长会话性能 |
| P1 | 流式 MD 节流（按行/按 50ms） | 少闪 |
| P2 | ↑ 输入历史、更好多行 | 交互完整 |
| P2 | 权限「本会话始终允许」 | |
| P3 | 滚动视口 / PgUp | Ink 限制大，或接受外部 scrollback |
| P3 | `@` 文件补全 | |

### C3. 有意可后置

- 完整 OpenTUI 迁移  
- Codex 级 overlay transcript  
- 精确本地 tokenizer（tiktoken）——仅当 usage 缺失时的 fallback，不要当主路径  

---

## D. 参考链接

**上下文**

- Claude Code 上下文工程拆解：https://github.com/Windy3f3f3f3f/how-claude-code-works/blob/main/en/docs/03-context-engineering.md  
- Inside Claude Code · Compaction：https://y-agent.github.io/inside-claude-code/04-context-compaction.html  
- 官方 Explore context window：https://code.claude.com/docs/en/context-window  

**TUI**

- OpenCode TUI DeepWiki：https://deepwiki.com/sst/opencode/6.2-terminal-user-interface-(tui)  
- OpenCode stream coalesce：https://github.com/anomalyco/opencode/pull/13026  
- Codex `chatwidget.rs`（active_cell / transcript）：https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget.rs  

---

## E. 待办勾选

- [x] Usage 锚点 + rough token 估计驱动 compact  
- [x] `/status` 或 footer 显示 ctx%  
- [x] Resume 重建 TUI timeline  
- [x] 流式节流；**OpenTUI** sticky ScrollBox + 工具详情固定面板  
- [x] `/context` 分类拆解（粗）  
- [ ] （不做短期）Claude 自研 Ink fork VirtualMessageList、本地 tiktoken 主路径  
