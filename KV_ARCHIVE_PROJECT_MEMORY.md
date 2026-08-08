# KV Archive｜项目总记忆母本

更新时间：2026-07-31
状态：用户确认的项目级真源

## 当前工程节点：v0.16.6 自适应主题 GUI

- 插件和 Notes PWA 统一支持“跟随系统 / 浅色 / 深色”。
- 主题只属于表现层，不进入数据库、证据、项目状态或导出协议。
- 浅色保持温暖纸张与深墨绿，深色保持黑绿档案室，不采用简单反色。
- 用户选择跨页面持久化；跟随系统时响应操作系统主题变化。
- 当前达到本地验证，真实 Chrome 与真机视觉验收仍待完成。

## 1. 正式命名

产品正式名称统一为：**KV Archive**。

此前开发对话与代码中出现过 `ContextVault`，用户口误中也出现过 `Context Fault`。这些名称从现在开始均视为历史开发代号，不再作为对外产品名使用。

命名规则：

- 对外官网、产品介绍、安装包标题、版本说明、用户文档统一使用 `KV Archive`。
- 内部代码中的旧命名可以分阶段迁移，不要求一次性破坏性重命名。
- 任何新功能、新文档、新官网文案不得继续把 `ContextVault` 当作正式品牌。
- 旧版本兼容、数据库名称、内部协议或路径如暂时保留旧名，必须标注为历史技术标识，而非品牌名称。

## 2. 产品起点

KV Archive 最初不是一个 Agent 基础设施项目，而是一个面向网页端 AI 用户的对话导出、备份与资产保存工具。

真实起点包括：

1. 用户长期使用 ChatGPT、DeepSeek、Gemini、Claude、Kimi、豆包等网页端 AI。
2. 网页端积累了大量对话、文件、提示词、研究材料、创作成果与项目讨论。
3. 用户担心账号异常、平台变化、误删、附件失效或历史记录无法迁移。
4. 即使记录没有丢失，长期沉积在聊天列表中也难以搜索、复用和继续工作。

因此，KV Archive 的第一层价值始终是：

> 让用户真正拥有自己的 AI 对话与工作资产。

## 3. 当前产品定位

KV Archive 不是单纯的聊天导出插件，也不是只服务桌面 Agent 的记忆工具。

当前正式定位：

> **面向网页端 AI 重度用户的本地优先 AI 资料归档、知识复用与项目连续性系统。**

更完整的长期定位：

> **跨 AI、可验证、可迁移、可回滚的个人与团队项目连续性系统。**

对外传播时不应一开始堆叠 MCP、Evidence URI、三级记忆等技术词。用户首先应理解三个入口：

- 我怕 AI 聊天记录丢失。
- 我想找回并复用以前的内容。
- 我想换一个 AI 继续当前项目。

## 4. 核心目标用户

### 4.1 初期核心用户

主要使用网页端 AI，并且已经把 AI 当作工作工具的重度用户：

- 内容创作者、写作者、策划与自媒体用户；
- 产品经理、独立开发者与轻技术用户；
- 研究者、论文作者、学生和知识工作者；
- 长期使用 ChatGPT、DeepSeek、Gemini、Claude 等多个平台的人；
- 已在网页端积累大量重要历史记录，但尚未完全迁移到桌面 Agent 工作流的人。

### 4.2 次级用户

- Obsidian、思源、Notion 等个人知识管理用户；
- Codex、Cursor、Claude Code 等 Agent 用户；
- 个人工作室、咨询团队与小型项目团队。

### 4.3 后期用户

- 需要组织记忆、人员交接、权限、审计和私有部署的团队与机构。

## 5. 需求真假与产品作用

### 5.1 硬需求

- 对话、附件和项目资料的可靠备份；
- 从大量历史对话中快速找回内容；
- 跨平台统一归档；
- 新对话、新模型、新账号或新 Agent 中继续长期项目；
- 关键决策、保护区和项目状态不因换窗口而丢失；
- 数据可导出、可阅读、可迁移，不被 KV Archive 锁死。

### 5.2 软需求但重要

- 高质量 HTML 阅读体验；
- Obsidian 双向链接、Graph View 与 Canvas；
- 自动摘要、主题分类与知识资产感；
- 好看的可视化和清晰的项目主页。

这些能力影响首次惊喜、舒适度和传播，但不单独承担核心付费价值。

### 5.3 特定人群的真需求

- MCP、CLI、Agent Bridge；
- Context Pack；
- 热、温、冷三级记忆；
- Evidence URI；
- 状态提案、审核、冲突和回滚；
- 团队治理与组织记忆。

### 5.4 容易高估的需求

- 自动把所有聊天变成完美第二大脑；
- 无限制抽取概念和生成巨大知识图谱；
- 只用炫酷星图作为长期价值；
- 把 Token 节省当作普通用户的第一卖点。

核心判断：

> 备份负责获客，搜索负责留存，项目接力负责付费，星图负责传播。

## 6. 产品形态

KV Archive 最终是一套产品，而非单一插件。

### 6.1 KV Archive Capture

浏览器扩展，负责：

- 网页端 AI 对话与附件采集；
- 当前对话导出；
- 历史、归档与 Project 备份；
- 快速收藏、归档和项目归属；
- 一键生成或注入项目接管包。

### 6.2 KV Archive Desktop

未来本地桌面主应用，负责：

- 本地统一数据库；
- 多平台、多账号管理；
- 浏览器关闭后的后台任务；
- 全文检索、附件、去重、快照和时间机器；
- 记忆审核、项目连续性和本地模型；
- 与 Obsidian、思源、Agent 的稳定连接。

### 6.3 KV Archive Connect

连接与适配层：

- Obsidian；
- 思源；
- Notion；
- MCP；
- CLI；
- Codex、Cursor、Claude Code；
- WebDAV、云盘、NAS 和可选加密同步。

### 6.4 KV Archive Team

后期团队版：

- 团队 Project；
- 权限、审批和审计；
- 人员离职与项目交接；
- 组织记忆；
- 私有部署和企业 MCP。

总结构：

> 浏览器插件负责“收”，本地桌面端负责“管”，知识库与 Agent 接口负责“用”，云端与团队端负责“协作”。

## 7. 免费与付费分层原则

核心原则：

> 不靠扣住用户自己的数据收费，而靠自动化、持续性、跨平台和高级利用能力收费。

### 7.1 免费层：KV Archive Backup

建议包含：

- 当前对话和手动选择对话导出；
- HTML、Markdown、JSON；
- 基础历史备份；
- 基础本地资料库与全文搜索；
- 基础 Obsidian Vault 导出；
- 随时读取、删除和迁移自己的数据。

可以限制：自动化程度、平台数量、活跃 Project 数量和高级接力能力。

### 7.2 个人付费层：KV Archive Continuity

面向网页端重度用户和长期项目用户：

- 定时增量备份；
- 多平台统一采集；
- 全量历史与附件维护；
- 多 Project；
- 高级搜索、去重和版本；
- Obsidian 增量更新；
- Project Memory；
- 一键跨模型接力；
- 项目时间机器；
- 冲突和过期记忆提示。

用户购买的是：**项目不断档**。

### 7.3 专业层：KV Archive MemoryOps

面向开发者、研究者、Agent 用户与个人工作室：

- MCP、CLI、Local Agent Bridge；
- Memory Gate；
- Verified Handoff；
- Context Budget 与缓存；
- 本地 Embedding；
- 高级证据追踪；
- 决策结果账本；
- AGENTS.md、CLAUDE.md 等宿主适配。

### 7.4 团队层

后期提供权限、审批、审计、组织记忆、离职交接、私有部署和数据策略。

## 8. 护城河与差异化

不把以下能力误判为长期壁垒：

- 普通导出；
- Markdown；
- 星图；
- RAG；
- 向量检索；
- MCP；
- 三级记忆界面。

真正可积累的壁垒包括：

### 8.1 高保真跨平台采集

长期处理平台结构变化、分支、附件、Project、账号、历史版本和异常数据。

### 8.2 Memory Gate｜可信记忆准入

每条进入 AI 上下文的信息都经过范围、新鲜度、取代关系、冲突、证据、权限和任务适用性检查。

### 8.3 Verified Handoff｜可验证接力

不仅生成 Context Pack，还验证新 AI 是否真正理解项目目标、状态、决策、保护区、风险和下一步。

### 8.4 Project Time Machine｜项目时间机器

恢复某个时间点的项目状态、决策、任务、有效记忆、Agent 配置和上下文版本。

### 8.5 Outcome Ledger / Experience Graph

记录：问题 → 决策 → 行动 → 结果 → 复盘 → 规则更新。

长期壁垒来自真实失败样本、接力评测数据、用户纠错反馈和经过现实验证的经验图谱。

## 9. 当前已开发能力

截至 v0.11.1 本地验证版本，已经具备：

- ChatGPT 当前、历史、归档、Project 对话备份；
- 图片、文件和生成附件采集；
- 定时增量备份、启动补跑、断点续跑和内容哈希去重；
- 快照、保留策略与垃圾回收；
- ChatGPT 风格 HTML、悬浮目录和搜索；
- 本地资料库与全文搜索；
- Agent Bundle、MCP、Context Pack；
- 状态提案、审核、版本、冲突和回滚；
- 核心记忆、Project 记忆、任务上下文与输入框注入；
- Obsidian Vault 导出；
- YAML Properties、Wiki Links、Graph View 数据和 Project Canvas；
- 稳定路径、重复导出保护、低内存分卷；
- 本地已下载附件写入 Obsidian `90 Attachments/`。

当前状态是本地验证，不等于已发布到真实用户环境；尚未完成 Git commit、push、PR、CI 和真实 Obsidian 全量验收。

## 10. 当前开发路线

下一阶段不能只把“三级记忆”当成最高目标。三级记忆应作为内部优化手段。

建议路线：

1. `Continuity Benchmark`：建立项目接管基线和评测集；
2. `Memory Gate`：范围、过期、取代、冲突、证据、权限和准入理由；
3. `Verified Handoff`：一键接管与接管报告；
4. `Project Time Machine`：状态分支、Diff 和恢复点；
5. `Outcome Ledger`：决策、行动、结果与复盘闭环；
6. 三级记忆、BM25、Embedding、缓存与低 Token 优化；
7. 消息级分块去重；
8. Obsidian Companion Plugin；
9. Notion Adapter；
10. 思源 Adapter；
11. 本地桌面端与团队 MemoryOps。

## 11. 官网必须同步修改的内容

官网分支目前缺少本项目后续迭代记忆，至少需要同步以下变化：

### 11.1 品牌

- 全站产品名统一为 `KV Archive`。
- 删除或降级所有把 `ContextVault` / `Context Fault` 作为正式名称的内容。

### 11.2 首页定位

不应只写“ChatGPT 导出工具”或只写“Agent Memory”。

推荐主定位：

> 保存、找回并继续你的 AI 工作。

候选副标题：

> KV Archive 为网页端 AI 用户提供本地优先的对话备份、统一搜索、知识库导出与跨模型项目接力。

### 11.3 首页三条用户路径

- 我怕聊天记录丢失；
- 我想把 AI 对话变成知识资产；
- 我想在另一个 AI 中继续项目。

### 11.4 官网产品叙事顺序

1. 数据属于用户；
2. 一键备份和离线阅读；
3. 从所有历史中搜索；
4. 导出到 Obsidian 等知识库；
5. 跨 AI 继续长期项目；
6. 专业用户再看到 MCP、Agent 和 MemoryOps。

### 11.5 不宜作为首屏卖点

- Evidence URI；
- IndexedDB Schema；
- 热温冷三级记忆；
- 内容哈希；
- MCP 技术细节；
- 企业治理术语。

这些应该位于高级能力或技术页，而非普通用户首页。

### 11.6 产品形态说明

官网应逐步呈现：

- KV Archive Capture；
- KV Archive Desktop；
- KV Archive Connect；
- KV Archive Team。

现阶段应明确 Capture 已存在，Desktop / Team 属于路线图，避免把规划冒充现成产品。

## 12. 对外核心表达

可使用：

- **保存、找回并继续你的 AI 工作。**
- **AI 会忘，你的项目不能重来。**
- **换一个 AI，也不用重新解释一遍。**
- **把散落在网页 AI 里的工作，变成真正属于你的长期资产。**

避免把产品描述为单纯的“第二大脑”“聊天下载器”或只服务程序员的 Agent 工具。

## 13. 当前开放问题

- 首批真正高留存用户是备份型、搜索型还是接力型；
- 哪个平台应成为 ChatGPT 之后的第二采集源；
- 免费层自动备份、平台数量与 Project 数量的具体限额；
- 是否先做 Windows 桌面端；
- 用户是否愿意为 Verified Handoff 付费；
- Obsidian 星图是否只带来首次传播，还是能带来重复使用；
- 本地优先与可选云同步的最佳信任模型。

这些问题需要通过真实行为数据验证，不能只靠内部讨论定论。

## 14. 以后默认执行的项目规则

1. 用户提到本产品时，统一称为 **KV Archive**。
2. 讨论官网、安装包、产品文案和对外传播时使用新名称。
3. 提及 `ContextVault` 时只作为历史开发代号或旧内部标识。
4. 不把产品自动缩窄成 Agent 记忆工具，必须保留网页端 AI 用户、数据安全、搜索和知识复用主线。
5. 不把 Obsidian 星图当成核心留存价值；它是传播和知识库出口。
6. 不靠锁住用户数据收费。
7. 新功能优先判断是否提升：备份可靠性、找回效率、项目连续性、可信接力或经验复用。
8. 官网分支和开发分支应共享本文件作为项目认知真源。

## 15. 最近记忆快照（2026-07-27）

- 产品正式名称统一为 **KV Archive**；`ContextVault`、`Context Fault` 只视为历史开发代号或口误，不再用于官网和后续对外表达。
- 当前另有一个官网前端分支，官网名称已经使用 **KV Archive**，但该分支缺少本开发会话中的最新产品记忆，需要按本母本同步定位、功能边界、用户分层、免费/付费逻辑和路线图。
- KV Archive 的初期核心用户不是单纯 Agent 开发者，而是长期使用 ChatGPT、DeepSeek、Gemini、Claude、Kimi、豆包等网页端 AI，并积累大量重要对话、附件、研究和长期项目的重度用户。
- 核心价值链：**备份负责获客，搜索负责留存，项目接力负责付费，星图负责传播。**
- 产品核心定位：本地优先的 AI 资料归档、知识复用与项目连续性系统；长期方向是跨 AI、可验证、可迁移、可回滚的个人与团队项目连续性系统。
- 产品形态：`KV Archive Capture` 浏览器扩展、`KV Archive Desktop` 本地主应用、`KV Archive Connect` 知识库与 Agent 连接层、`KV Archive Team` 团队与机构版。
- 免费层保障用户对自己数据的读取、导出、删除和迁移；付费层主要售卖自动化、多平台统一、项目连续性、可信记忆、版本恢复和高级接力，不靠锁住用户数据收费。
- 当前开发版本已到 v0.11.1，具备 ChatGPT 备份、附件、资料库、搜索、状态/记忆、Agent Bundle、Obsidian Vault/Graph/Canvas 导出及附件写入等能力；真实 Obsidian、真实跨平台采集、桌面端、Notion/思源适配和完整 Verified Handoff 仍在后续规划。
- 后续所有官网文案、产品命名、路线规划和开发交接，优先读取本文件，避免分支继续沿用旧称或旧定位。


## 16. 最近界面升级快照（2026-07-27）

- 浏览器扩展对外版本推进到 **KV Archive v0.11.2 Interface Upgrade**。
- Popup、备份中心、本地资料库、项目状态、记忆同步和 Obsidian 图谱已统一为一套应用外壳与视觉系统。
- 视觉命题：安静的档案仪器感、烟熏金属与暖纸、索引式导航、语义状态灯、克制动效。
- 主原型是工业技术工具，辅助原型是数据管理工作台；不采用通用紫蓝渐变、满屏玻璃卡片、无意义粒子或远程字体。
- 本轮只升级品牌、布局、信息层级、响应式、主题和交互反馈，未改变数据库、API、权限、备份、状态、记忆或导出语义。
- 六个页面原有 133 个运行时元素 ID 全部保留；自动化测试 130/130 通过；22 个静态 Chromium 渲染组合无横向溢出和资源缺失。
- 当前状态仅为本地验证完成；真实 Chrome 扩展加载、登录态操作和完整浏览器 E2E 仍需按 `REAL_UI_ACCEPTANCE.md` 验收。

## 17. 最近备份可靠性修复快照（2026-07-27）

- 浏览器扩展版本推进到 **KV Archive v0.11.3 Conversation-first Backup Reliability**。
- 真实大账号反馈显示备份常在约 75% 暂停，并错误提示 ChatGPT 登录失效。
- 代码核验确认：75% 对应附件下载阶段；旧版手动全量备份默认下载全部附件；任一附件接口返回 401/403 都会被误判为整个账号登出。
- 手动备份现在默认只保存对话正文与附件来源引用，不默认保存附件二进制；用户可以显式选择“同时下载可访问附件”。
- 长任务中的 ChatGPT 鉴权上下文在 401/403 后会刷新并重试一次；附件签名地址失效时也会重新签名并重试一次。
- 单个附件不可访问时，系统先独立验证会话是否仍有效。会话仍有效则跳过该附件、保留失败记录并继续，不再破坏已经完成的对话备份。
- 继续旧任务时优先使用该任务已锁定的账号/工作空间身份，降低空间重新识别失败造成的误报。
- 本轮没有数据库迁移，没有删除旧附件或对话对象。自动化测试 135/135 通过；真实 Chrome 大账号恢复测试仍待用户验收。


## 18. v0.12.0 Readable Export & Agent Handoff（2026-07-27）

### 用户反馈形成的产品判断

- 原始归档、用户阅读和 Agent 上下文必须分层；“底层尽量不丢”不等于“每次全部展示或全部喂给 Agent”。
- 工具调用、原始工具结果、模型推理摘要和无正文内部节点默认不进入阅读版、搜索索引或 Agent 消息上下文。
- 用户可见文件名、普通链接、下载入口、原对话来源和稳定标识的价值远高于其存储体积；链接可以默认保存，但不得承诺远程资源永久有效。
- Obsidian 导出完成标准不是“生成 ZIP”，而是让小白用户或本地 Agent 能安全地把内容放进新 Vault 或已有 Vault，并且可验证、可回滚。
- 复杂产品默认同时设计小白路径、高级路径和 Agent 接管路径；功能可以深，首屏必须浅。

### 实际实现

- 默认 HTML/Markdown 进入 readable 模式；完整 ZIP 增加独立 technical-evidence HTML/Markdown，同时保留 raw/canonical/integrity evidence。
- 文件、图片、引用、Canvas 和工具生成产物恢复可用链接；签名、blob 和 sandbox 链接明确提示可能过期，并保留打开原对话入口。
- 资料库索引、Agent 消息和 Obsidian conversation body 默认排除 tool_call、tool_result、reasoning_summary 和 unknown；原始证据不删除。
- Obsidian 包增加 START_HERE、IMPORT_OPTIONS、AGENT_PROMPT、AGENT_HANDOFF、机器 Manifest 和回滚收据模板。
- Obsidian 页面增加复制 Agent 交接指令；备份和 Obsidian 高级参数采用渐进披露。
- 版本提升至 0.12.0，无数据库迁移。

### 验证状态

- 本地 clean build 和完整测试 141/141 通过。
- 3,000 会话 Obsidian 性能烟测完成，0 坏链接、0 Canvas 引用错误，逐条读取。
- 1,200 会话归档性能烟测完成，29 个受控分卷，逐条读取。
- 状态为 LOCALLY_VERIFIED；真实 Chrome 原地升级、真实 ChatGPT 链接、真实 Obsidian 和本地 Agent 验收仍待执行。
- Smart Selection 与 Capture Library 不在 v0.12.0 交付范围内。

## 19. v0.12.1 HTML 内容控制（2026-07-27）

- 当前对话导出分为精简对话、仅 AI 正式回答和完整技术记录三档。
- 默认不把工具调用、工具结果、推理摘要和内部事件交给用户或本地 Agent。
- 技术内容只有用户主动选择时进入文件，并在 HTML 中默认折叠。
- 当前对话 ZIP 只有技术档才包含 raw、canonical 和 technical-evidence 文件。
- 本地验证 142/142 通过；真实 Chrome 导出仍需验收。

## 20. v0.12.2 最后一公里体验（2026-07-27）

- 弹窗从固定功能菜单改为状态感知的下一步助手；常用入口与长期项目高级能力分层。
- 保存当前对话默认进入本地资料库，下载 HTML、Markdown 或 ZIP 变为可选动作；保存完成后可立即查看资料库或显示下载文件。
- 备份中心首屏明确区分浏览器本地数据、电脑 ZIP 分卷、浏览器容量和持久化保护；详细统计默认收起。
- 全量备份启动前增加只读预检，展示工作空间、预计规模、Project、附件策略和存储容量，确认后才采集。
- 缺少 ChatGPT 标签页、登录失效、空间不一致和下载中断等错误增加直接恢复动作。
- Obsidian 质量门先给出“可以安全导出 / 可以导出但有缺失 / 暂不建议导出”，技术指标保留在折叠报告中。
- 无数据库迁移，不删除 Raw Evidence，不改变备份、分卷、快照或恢复算法。
- 本地完整测试 147/147 通过；真实 Chrome 原地升级、真实账号、真实下载目录和真实 Obsidian 验收待执行。

## 21. v0.13.0 Continuity Benchmark（2026-07-27）

- KV Archive 正式加入第一层可验证接力能力：从 Agent Bundle 和已审核 Project State 生成公开挑战、响应模板与私有答案键。
- 接收方 Agent 需要结构化回答 Project 身份、当前状态、有效决策、未完成任务、阻塞、下一步和 Evidence URI。
- 评分完全由本地确定性程序执行，不调用模型；总分 100，85 分以上且无关键错误才显示 Verified PASS。
- Project ID 错误、编造 Decision/Task ID、引用无效 Evidence URI 会直接阻止 PASS。
- Agent Bridge 新增 `benchmark-create` 与 `benchmark-score`，同时提供 Windows 和 shell 辅助脚本；输出 JSON 与 Markdown 接管报告。
- 公开挑战不包含答案；`benchmark-answer-key.json` 必须只由发送方保留，不能交给接收方 Agent。
- Agent Bundle Manifest 新增 `continuityBenchmarkVersion: 1`，并附带使用说明；旧 Bundle v1/v2 和旧命令别名继续兼容。
- 本地 clean build、类型检查和完整测试 151/151 通过；真实 Codex、Claude、Cursor 和不同 Token 档位的对比验收仍待执行。
- 下一阶段以真实 Benchmark 失败样本设计 Memory Gate，再将 Context Pack、挑战、评分和报告整合成 Verified Handoff。

## v0.14.2 Unified Capture / Note / Stellar Graph（2026-07-29）

- 建立独立于 Raw Evidence 的可编辑内容层，支持 note、flash、web_excerpt、ai_excerpt、image、file。
- IndexedDB 版本升级为 11，新增 capture-items、capture-versions、capture-relations、capture-operations、capture-promotions。
- 每次修改产生不可变版本和操作日志；使用 revision 冲突阻止静默覆盖。
- Content Evidence URI 固定到 objectId + revision + contentHash。
- 内容可进入知识图谱、Obsidian、Agent Bundle v3、MCP 与 Context Pack。
- Memory / Decision / Task 晋升均先生成待审核草案，不直接改写批准状态。
- Raw Evidence content-objects 不迁移、不重写。
- 本地验证：209/209；1,200 会话低内存、3,000 快照、3,000 Obsidian 性能烟测通过。
- 外部未验收：IndexedDB 10→11、真实 Capture Center、notes-only Obsidian、Bundle v3 receiving Agent。

## v0.14.3 Portable Capture Package & Recovery（2026-07-29）

- 可编辑 Capture / Note 层获得独立的可迁移恢复格式，不再错误地把 Agent Bundle 当数据库恢复包。
- Portable Capture 包包含当前内容对象、全部不可变版本、类型化关系、操作日志与晋升记录，并以 scope、计数和 payload hash 自证完整性。
- 导入严格采用“先干运行、后确认写入”：Project 冲突、同 revision 不同 hash、分叉历史、不可变记录 ID 冲突都会阻止整次写入，不做静默合并或部分导入。
- 相同记录直接跳过；只有当输入历史包含本地精确 revision/hash 时，才允许安全快进。
- 每次导入、无变化导入与回滚都产生不可覆盖回执。回滚只撤销该回执明确新增或快进的记录；后续编辑、新关系/操作/晋升依赖或记录变化会阻止破坏性回滚。
- Raw Evidence `content-objects`、已批准 Project State、认证信息和二进制附件不进入该恢复包，也不在恢复写入范围内。
- IndexedDB 版本升级到 12，新增 `capture-recovery-runs`；“未绑定 Project”是独立 scope，不能被误解为全量导出。
- 本地验证：219/219；3,000 内容对象恢复包以及原三组性能烟测通过。
- 外部未验收：真实 Chrome 11→12 升级、浏览器 ZIP 下载/选择、真实冲突报告、导入回执与回滚。

## 2026-07-29 — v0.15.0 Verified Handoff v1

- Added Project-scoped receiver package and physically separate private verification kit.
- Added deterministic preflight before extraction and post-run Continuity verification.
- Added sender, receiver and completion receipts with explicit local self-attestation trust model.
- Added CLI/wrappers for create, receive and verify.
- Preserved approved-State read-only behavior, Agent Bundle v1/v2/v3 compatibility and all prior capture/recovery paths.

## 2026-07-29 — v0.16.0 Notes PWA Alpha

- Decision: mobile development begins with an installable phone-first PWA, not an immediate native APK/iOS shell.
- Reason: reuse the accepted unified Capture/recovery contract, validate real usage early, keep rollback simple, and defer native-platform cost until the product workflow is proven.
- Completed locally: quick capture, offline timeline/search, Projects, immutable versions, archive/trash recovery, Portable Capture interoperability and installable service-worker shell.
- Verification: 233/233 tests, 10,000-note bounded-render smoke, and local Chromium persistence/offline runtime smoke.
- Boundary: no sync, Share Target, native notifications, native shell or app-store claim in Alpha.
- Next: v0.16.1 Project-local Stellar Graph Mobile, then v0.17.0 Share Target/Capture Inbox, then v0.18.0 synchronization and Android shell.

## 2026-07-30 — v0.16.2 Bulk Capture Control & Partial Export

- Corrected the large-batch mental model: capture into durable browser storage and export to local ZIP are separate stages.
- Added safe pause/resume and “pause then export saved”; already committed artifacts remain available after pause, page close or stale checkpoint.
- Added read-only partial export snapshots with explicit saved/selected/remaining/failed progress. Export never mutates the source capture task.
- Added a 60-second per-conversation request budget, two-attempt selected-batch ceiling and pause-aware retry cancellation so one bad conversation cannot lock the batch.
- Added bounded catalog/selection rendering for high-volume accounts.
- No database migration; Raw Evidence, Project State, Memory, recovery and Agent contracts remain unchanged.
- State is locally verified; real logged-in Chrome acceptance remains pending.

## 2026-07-30 — v0.16.4 Ten-Minute Incremental Acceptance

- Added an independent one-time ten-minute Chrome Alarm so scheduled incremental behavior can be checked without waiting 1–3 days.
- The test requires a pre-existing logical snapshot and refuses to mislabel a first full capture as incremental verification.
- The alarm runs the real incremental engine, bypasses production enabled/idle guards only for the explicit test, and continues through durable time slices for large accounts.
- Results distinguish `passed_with_changes`, `passed_no_changes`, and `failed`, with baseline/latest snapshot identities and per-domain change counts stored durably.
- Pending test alarms and test continuations are reconciled after extension startup; waiting tests can be cancelled without deleting snapshots.
- Test mode does not mutate recurring settings and does not automatically export a ZIP. A real test run may update the last-success timestamp used by an already-enabled schedule.
- Locally verified: 255/255 tests and six performance gates. Real logged-in Chrome acceptance remains pending.

## v0.16.5 unified task feedback

- Added one shared task feedback system across extension long operations.
- Product rule: a click must be acknowledged immediately; the user must know the current stage, whether progress is measurable, where partial work is stored, and what happens next.
- Determinate percentages come only from real counts. Unknown-duration work uses an explicit indeterminate state.
- Pause and failure preserve the completed portion; success explains the destination of the result.
- Mobile safe-area and reduced-motion behavior are part of the contract.
- No database migration or archive/evidence contract change.
- Local verification: typecheck, clean builds, 259/259 tests and all six performance gates passed. Real Chrome visual and interaction acceptance remains pending.

## v0.16.8 — UI Visibility & Contrast Hardening (2026-08-06)

Current state: `LOCALLY_VERIFIED`, real owner-profile Chrome acceptance pending.

- Added final visibility layers after semantic themes across extension and Notes PWA.
- Fixed undefined Capture Center theme aliases and global button-role cascade conflicts.
- Established explicit normal/secondary/ghost/danger/disabled color pairs and a 12 px interactive-copy floor.
- Corrected popup, Backup, Basket, Library, Capture, State, Memory Gate and Obsidian page-specific readability.
- Preserved native hidden behavior so empty recovery/action controls cannot surface.
- Chromium computed-style audit: 16 extension light/dark renders, normal/hover/focus control states and 2 PWA renders, 0 remaining size/contrast findings.
- Full regression: 269/269 passed; all six performance gates passed.

## 2026-08-06 — v0.16.9 Product Closure & Safety Hardening

- Audited visible-but-incomplete product paths instead of adding new showcase features.
- Corrected a high-risk semantic bug: `清空会话索引` now removes only searchable conversation/message/import indexes and preserves Raw Evidence, Project State, approved context, Memory Gate, Capture, recovery and knowledge records.
- Removed the silent 5,000-message search candidate cap; large result/detail/governance histories use bounded pagination.
- Added stale-request protection so old searches or Project reads cannot overwrite newer selections.
- Made desktop Capture Center capable of creating Projects; note-only Projects now enter State, Context, Obsidian and Agent export.
- Added collision-safe Project identity, Project retention after note save and explicit draft-save failure reporting.
- Corrected archive/restore/undo and relationship eligibility semantics.
- Agent export now reads only selected Project messages and current Evidence rather than the entire vault.
- Notes PWA now exposes real operation/relation rows and incremental histories.
- Local verification: 284/284 tests and all six performance gates passed. Real owner-profile Chrome acceptance remains pending.

## 2026-08-08 — v0.16.10 Handoff Truth & Scoped Storage Hardening

- Recovered and hash-verified the v0.16.9 Source, Notes PWA, Agent Bridge and Release Candidate as one consistent baseline before editing.
- Corrected stale engineering handoff state: root `AGENTS.md` no longer claims the repository begins in `PLANNED`, and `.agent-harness/CURRENT_STATE.md` now reflects v0.16.10.
- Project Agent export now reads Conversation/Capture/State through existing Project keys/indexes before fetching selected messages/current Evidence.
- Extension and Notes PWA Capture exports read version history by selected content-object IDs through the existing `objectId` index, avoiding whole version-store scans for scoped exports.
- PWA Service Worker activation is cache-namespace safe and only removes stale `kv-archive-notes-*` caches.
- Stale v0.16.7 package-builder fallback metadata was removed.
- No DB migration: Extension remains v13; Notes PWA remains v1; Evidence/Agent Bundle/Portable Capture/Project State/Memory Gate formats remain compatible.
- Local verification: 287/287 tests, typecheck and all six established performance gates passed. Owner-profile Chrome/mobile/same-origin-cache acceptance remains pending.
- Next strategic node remains integration of the separately developed note-app prototype through a Repository/Adapter bridge, after real v0.16.10 acceptance.
