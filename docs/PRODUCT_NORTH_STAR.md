# KV Archive Product North Star

Date: 2026-08-09  
Baseline: v0.16.11

## One-sentence mission

让用户拥有自己的 AI 工作历史，并让任何新的 AI / Agent 能在可验证、可回滚、低 Token 的前提下继续这段历史。

## The end result we are building toward

KV Archive 最终应成为一层本地优先的 **AI Work History & Continuity Layer**。它跨越网页 AI、笔记、文件、项目、Agent 与设备，持续维护用户自己的工作历史，而用户无需把项目连续性押在某一个聊天窗口、某一个模型、某一个账号或某一个厂商上。

最终用户应该获得五种长期收益：

1. **拥有**：重要对话、附件、笔记、决策和项目状态由用户自己掌握，并有完整性与来源证据。
2. **找回**：任何旧信息可以通过搜索、Project、时间、来源、关系和局部知识图快速定位。
3. **继续**：新的 ChatGPT、Codex、Cursor、Claude Code 或本地 Agent 能读到可信的项目上下文，并通过 Benchmark 验证是否真正接管。
4. **演化**：历史内容可形成版本、逻辑快照、Memory、Decision、Task、Outcome 与 Time Machine，而旧证据仍可追溯。
5. **迁移**：浏览器、桌面、手机、Obsidian、用户自有存储和 Agent 之间通过稳定协议流转，不依赖单一 UI。

## Product surfaces and their roles

### Browser Extension — Capture Adapter

负责网页端 AI 的采集、当前会话导出、历史/增量备份、快速入口与浏览器内反馈。长期定位是“采集适配器”，不承担全部产品职责。

### Core / Evidence Store — Durable Truth

负责 Canonical Schema、Raw Evidence、内容寻址、哈希、增量对象、逻辑快照、完整性、恢复与兼容。这里是最需要稳定的层。

### Project / Memory / Continuity — Work State

负责 Project State、Decision、Task、Memory Gate、Context Pack、Continuity Benchmark 与 Verified Handoff。目标是把“聊天历史”转化为可验证的工作连续性。

### Notes / Mobile — Low-friction Daily Capture

负责 flomo 式低阻力记录、时间流、系统分享、网页片段、搜索、回顾与 Project 归属。普通记录不自动升级为项目正史。

### Desktop / Sync — Durable Local Runtime

负责 SQLite / 本地对象库、长期后台任务、固定运行时、多设备同步、局域网配对、用户自有目录/NAS/WebDAV 等。它将逐渐接管浏览器不适合长期承担的大规模存储与后台调度。

### Connect / Agent Interface — Use the Archive

负责 Obsidian、MCP、CLI、Agent Bundle、Context Pack、用户自有工具和未来适配器。任何外部 Agent 默认只读，写入正式状态必须经过提案、Diff、批准和版本化。

## Non-negotiable product principles

- Local-first，默认无云端依赖。
- 默认零 Token；语义 AI 是可选增强层。
- Raw Evidence 与 Derived Content 分离。
- 不静默丢失未知节点、附件失败、分支或恢复冲突。
- 数据可验证、可回滚、可迁移。
- Agent 不能绕过治理层直接修改项目正史。
- 大库路径必须分页、流式或索引有界读取。
- 普通用户界面保持低认知负担，复杂能力通过渐进披露出现。
- 产品能力要同时服务用户、人类维护者和 AI Agent。

## Ultimate user story

用户可以数年持续使用多个 AI 平台和设备。KV Archive 自动维护他的历史、增量、来源和项目状态。某一天旧聊天窗口消失、模型更换、电脑迁移或 Agent 更换时，用户选择一个 Project，系统即可：

1. 找到当前有效状态与相关证据；
2. 通过 Memory Gate 排除过期、冲突或越界记忆；
3. 生成限定 Token 预算的 Context Pack；
4. 交给新的 Agent；
5. 用 Continuity Benchmark 验证接管；
6. 继续工作，并把新结果重新写回可审核的历史链。

达到这一状态时，KV Archive 才完成其核心使命。
