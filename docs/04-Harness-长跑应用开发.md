# 04 — Anthropic: Harness design for long-running application development

> 原文：https://www.anthropic.com/engineering/harness-design-long-running-apps  
> 作者：Prithvi Rajasekaran（Labs）· 发布：2026-03-24  
> 姊妹文（更早）：[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)（2025-11）  
> 笔记日期：2026-08-29 · 与 [`03-上下文管理调研与落地.md`](./03-上下文管理调研与落地.md) 互补（03 偏 context 压缩；本文偏 **多会话 / 多角色 harness 编排**）

---

## 0. 一句话

在 frontier agentic coding 上，**harness 设计本身就是性能杠杆**。本文把「前端审美」和「长时间无人值守全栈开发」两条线打通，核心模式是 **Generator–Evaluator（GAN 启发）**，最终落到 **Planner + Generator + Evaluator** 三代理架构；并强调：**模型变强后要持续拆掉不再承重的脚手架**。

---

## 1. 问题背景：朴素长跑为什么翻车

先前 harness（initializer + 按 feature 编码 + 跨会话 artifact）已有提升，社区也有类似思路（如 Ralph Wiggum：用 hook/脚本把 agent 钉在迭代循环里）。但复杂任务上仍常脱轨，作者归纳两类失败：

### 1.1 Context 填满 → 失焦 / 「context anxiety」

- 长任务随 context 增长失去连贯性（参见 context engineering 文）。
- 部分模型出现 **context anxiety**：自以为快碰到窗口上限，就**提前收工**。
- **Context reset**（清空窗口 + 结构化 handoff 交给新 agent）同时缓解「失焦」和「提前收工」。
- 这与 **compaction** 不同：
  - Compaction：同一条会话里摘要续跑，**没有干净白板**，anxiety 可能仍在。
  - Reset：干净起点，但依赖 handoff 是否足够；编排更复杂、更贵、更慢。
- 实验：Sonnet 4.5 上 anxiety 强到 **单靠 compact 不够**，reset 成为 harness 必需；后来 Opus 4.5 基本消掉该行为，新 harness **可以去掉 reset、靠 SDK 自动 compact 连续跑**。

### 1.2 自我评价偏粉

- Agent 评自己的活，常自信地夸「很好」——哪怕人类看很平庸。
- 主观任务（设计）尤其严重：没有像测试那样的二元判定。
- 即便有可验证结果，执行中仍可能判断力差。
- **杠杆：做活的 agent 与评判的 agent 分离。**  
  分离本身不会立刻消灭「对 LLM 输出偏心」，但 **单独调一个偏怀疑的 Evaluator 远比让 Generator 自我苛刻容易**；外部反馈给 Generator 可迭代的具体目标。

---

## 2. 前端实验：把主观质量变成可打分

### 2.1 两条洞察

1. 审美无法完全分数化，但可用 **编码偏好的评分标准** 改进：「美不美」难一致，「是否符合我们的设计原则」可打分。
2. **生成与评分分离** → 反馈环推动输出变强。

### 2.2 四条评分维度（Generator / Evaluator 共用）

| 维度 | 问什么 | 备注 |
|------|--------|------|
| **Design quality** | 是否成为连贯整体（色、字、布局、图形成统一气质） | 加权重 |
| **Originality** | 有无刻意创意，还是模板 / 库默认 / AI 套路 | 加权重；明确罚 purple-on-white 等 slop |
| **Craft** | 字阶、间距、色彩和谐、对比度等执行力 | 模型默认通常不差 |
| **Functionality** | 不依赖好看：用户能否理解界面、找到主操作 | 可用性 |

校准：给 Evaluator **few-shot + 详细分项打分样例**，对齐作者口味、减少分数漂移。

### 2.3 循环形态

- Claude Agent SDK 编排。
- Generator：按用户提示出 HTML/CSS/JS。
- Evaluator：带 **Playwright MCP**，**真点活页**（截图、细看），再打分 + 长文 critique。
- 反馈回 Generator；约 **5–15 轮**；单轮因真实导航耗墙钟，整跑可达约 **4 小时**。
- 每轮后 Generator 做战略选择：**分数在涨 → 精修；方向不行 → 整套审美 pivot**。

### 2.4 现象与启示

- 分数多轮上升后平台期，仍有余量。
- 有时中间轮次比最后一轮更好（非线性）。
- 复杂度随轮次上升（回应 critique 更敢做）。
- **仅 criteria + 措辞**（尚无 Evaluator）已比无 prompt baseline 好——标准本身在推离 generic。
- 措辞会塑形：如 “museum quality” 会导向特定视觉收敛。
- 荷兰艺术博物馆例子：第 9 轮还是预期内深色落地页；第 10 轮 **整盘推倒** 做成 CSS 透视 3D 展厅——单次生成很少见的创意跃迁。

---

## 3. 扩到全栈：三代理架构

把 Generator–Evaluator 映射到研发生命周期：**Code review / QA ≈ 设计侧的 Evaluator**。

继承早期 harness 两课：

1. **把构建拆成可处理的块**  
2. **用结构化 artifact 跨会话交接**

### 3.1 三个角色

| 角色 | 职责 | 设计意图 |
|------|------|----------|
| **Planner** | 1–4 句用户提示 → 完整产品 spec；野心大；偏产品语境 + 高层技术设计；可织入 AI 功能 | **不要过早写死细实现**——错了会级联污染下游 |
| **Generator** | 按 sprint / 一次一块从 spec 取 feature；指定栈（文中 React/Vite/FastAPI/SQLite→PG）；sprint 末自检；用 git | 控制「一次做太多」 |
| **Evaluator** | Playwright 真点应用（UI / API / DB）；按标准打分 + 找 bug；任一项低于硬阈值 → sprint 失败，反馈 Generator | 抓「看起来很炫但点就坏」 |

### 3.2 Sprint contract（关键机制）

每 sprint 编码前，Generator 与 Evaluator **协商「完成定义」**：

- Generator 提议：建什么、如何验证成功。  
- Evaluator 审：是否对准 user stories、是否可测。  
- 迭代直到双方同意，再写代码。

原因：产品 spec **故意偏高**，需要一步把「用户故事 → 可测实现」桥起来。

通信方式：**文件**（写文件 / 读文件 / 新文件回应），而不是复杂消息总线。

### 3.3 与旧 harness / 模型代际的关系

- 旧：initializer + coding agent + **context reset**（Sonnet 4.5 需要）。  
- 本文首版：Opus 4.5，**去掉 reset**，整次构建连续会话 + SDK **自动 compaction**。

---

## 4. 实验对比（Retro game maker）

同一句 prompt：

> Create a 2D retro game maker with features including a level editor, sprite editor, entity behaviors, and a playable test mode.

| Harness | 时长 | 成本 |
|---------|------|------|
| Solo（单代理） | ~20 min | ~$9 |
| Full harness | ~6 hr | ~$200 |

约 **20× 更贵**，质量差距一眼可见：

- **Solo**：布局浪费、流程不引导、**核心玩法坏了**（实体无输入响应，定义与 runtime 接线断）。
- **Full**：Planner 扩成 **16 feature / 10 sprint** 的大 spec（动画、行为模板、音效、AI 辅助、导出分享等）；读 frontend design skill 写入视觉语言；每 sprint 谈 contract；玩法基本能玩。Evaluator 按 contract 逐条 Playwright 打点，发现很具体（函数未挂 mouseUp、删除条件写错、FastAPI 路由顺序导致 422 等）。

### Evaluator 调参现实

- 开箱 Claude **是差 QA**：发现问题后又自圆其说放行；测得浅、漏边角。  
- 调法：读 Evaluator 日志 → 找与人类判断分歧的例子 → **改 QA prompt**；多轮后才「合理」。  
- 仍有余量：小布局问题、不直觉交互、深层功能未测到。  
- 相对 solo「核心功能完全不工作」，提升明显。

---

## 5. 简化 harness：原则与实操

### 5.1 原则（文中反复强调）

> **Harness 里每个组件都编码了「模型自己做不到什么」的假设；这些假设要压力测试——可能本来就错，也可能随模型升级迅速过期。**

对齐 *Building Effective Agents*：**先找最简方案，只在需要时加复杂度。**

激进砍掉再加新点子 → 难复现原性能，也分不清谁承重。改为：**一次拆一个组件**，看终局影响。

Opus 4.6 动机：更会规划、更长 agentic、更大库更稳、更好自审与长上下文检索 → 原先脚手架可能过时。

### 5.2 去掉 sprint 结构（V2）

- 保留 **Planner** 与 **Evaluator**（去掉后仍明显掉点）。  
  - 无 Planner → Generator **under-scope**（直接对着原始短 prompt 开写，功能更瘦）。  
- Evaluator 从「每 sprint」改为 **整跑末尾单轮（可多轮 build↔QA）**。  
- Evaluator **不是固定要/不要**：  
  - 任务在「模型 solo 可靠边界内」→ Evaluator 常是开销；  
  - 任务仍在能力边缘 → Evaluator 仍给真实 lift。

另：加强「应用内建可工具驱动的 agent」的 prompt（训练数据薄，需多轮调）。

### 5.3 DAW 实验（V2，Opus 4.6）

Prompt：`Build a fully featured DAW in the browser using the Web Audio API.`  
约 **3h50 / $125**。Builder 可 **无 sprint 连贯跑 >2h**。

| 阶段 | 时长 | 成本 |
|------|------|------|
| Planner | 4.7 min | $0.46 |
| Build R1 | 2h7 | $71 |
| QA R1 | 8.8 min | $3.24 |
| Build R2 | 1h2 | $37 |
| QA R2 | 6.8 min | $3 |
| Build R3 | 10.9 min | $6 |
| QA R3 | 9.6 min | $4 |
| **合计** | **~3h50** | **~$125** |

QA 仍抓住实质缺口：时间线 clip 不能拖、乐器面板缺失、录音 stub、效果器只有数字滑条无图形 EQ 等——Generator 仍会 **stub / 漏细节**，末英里 QA 有价值。

局限：Claude **听不见**，音乐品味类反馈环天然变弱。

---

## 6. 作者带走的教训（What comes next）

1. **对着真实任务读 trace，调到你要的行为。**  
2. 复杂任务有时需要 **分解 + 专职 agent**。  
3. **新模型落地后重新审视 harness**：拆掉不再承重的，加上新能力边界外的新件。  
4. 模型变强 → 有趣 harness 组合空间 **不是缩小而是移动**；AI 工程要找下一组 novel combination。

---

## 7. 姊妹文速记（Effective harnesses…, 2025-11）

长跑跨多 context window 的早期答案（与本文「reset / artifact」一脉）：

| 问题 | Initializer | Coding agent |
|------|-------------|--------------|
| 过早宣称整项目完成 | 写完整 **feature_list.json**（端到端步骤，`passes: false`） | 开局读列表，**一次只做一个** feature |
| 留下烂摊子 / 无文档进度 | 初始 git + progress 文件 | 开局读 progress + `git log`；先跑基本 E2E；结束 **commit + 写 progress** |
| 未测就标完成 | 同上列表 | 强约束：认真测完才改 `passes`；勿删改测试项 |
| 每次重学如何跑应用 | 写 **init.sh** | 开局读并跑 init.sh |

启动仪式：`pwd` → progress → feature list → git log → init.sh → **先验证基础仍工作再开新 feature**。

Feature list 用 **JSON** 优于 Markdown（更不易被模型乱改结构）。  
测试：显式要求 **浏览器自动化像真人**；仅 unit/`curl` 不够。

与本文关系：姊妹文解决 **跨窗口记忆与增量**；本文在之上加 **独立评判 + 规划**，并讨论 **模型升级后如何减负**。

---

## 8. 对 NanCodeAgent 的启示（落地对照）

课程期内 **不必** 上完整 Planner/Generator/Evaluator 三代理（硬禁 agent 框架；子 agent 也标为后置）。可吸收的 **可落地思想**：

| 思想 | Nan 可怎么做（轻量） |
|------|----------------------|
| 增量 + 干净交接 | 鼓励/约定 `PROGRESS.md` + 描述性 commit；`/compact` 摘要后保留「下一步」与路径列表（见 03） |
| Feature 清单防「假完成」 | 用户任务可写成 checklist JSON；agent 一次一项；测完才勾 |
| **会话内执行 Todo** | 开源主流用 `TodoWrite` / `todowrite` / `update_plan`（见 [`05-Todo清单与执行前规划.md`](./05-Todo清单与执行前规划.md)） |
| 自夸偏差 | Plan mode 出方案 / Agent 实现；或事后用只读工具做「验收清单」自检（同模型但不同 prompt 角色） |
| Sprint contract | `/plan` 产出「完成定义 + 验收步骤」，`/agent` 严格按合同执行 |
| Compaction vs Reset | 短期：真 LLM `/compact`；长任务若仍 anxiety/失焦，可考虑「新 session + 读 PROGRESS/git」式 reset（比假装无限 compact 更干净） |
| Harness 随模型减负 | 脚手架（强制 sprint、强制每轮 QA）做成 **可开关**；强模型默认简、弱模型/难任务再开 |
| 真用户路径验证 | 有 UI 任务时优先「跑起来再点」；Nan 可用 bash + 测试命令近似，不必先上 Playwright MCP |
| 文件通信 | 角色间交接用 workspace 文件，简单可靠 |

**刻意不做（短期）：** 多小时无人值守三代理、$100+ 成本环；GAN 式 15 轮前端审美环——与课程范围不符。

与 03 的分工：

- **03**：窗口内 token 怎么塞、怎么压、epoch/cache。  
- **04（本文）**：任务跨小时/跨会话时 **谁规划、谁实现、谁验收、何时 reset、何时拆脚手架**。

---

## 9. 参考

- https://www.anthropic.com/engineering/harness-design-long-running-apps  
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents  
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents  
- https://www.anthropic.com/research/building-effective-agents（文中引用的「最简复杂度」原则）  
- 相关内部笔记：[`03-上下文管理调研与落地.md`](./03-上下文管理调研与落地.md)
