# KV Archive v0.13.1｜Multi-Provider Foundation & Conversation Basket

## 版本目标

把 KV Archive 从 ChatGPT 专属采集结构迁移到平台中立的数据契约，并补齐“以完整会话为单位多选后批量导出”的中间工作流。

本版本不宣称已经完成所有 AI 平台的结构化历史备份。当前能力分为两层：

- ChatGPT：继续使用已有结构化当前对话和高保真历史 Adapter；
- 其他已识别或用户主动指定的网页：使用 `VISIBLE_ONLY` 通用采集，只保存页面当前可见内容，并明确标记完整性边界。

## 本次实现

### 1. Canonical Schema v0.2

- `source.provider` 不再写死为 ChatGPT；
- 新增 `captureMode` 与 `completeness`；
- 新增 `primaryCollectionId` 与 `collectionRefs`；
- 保留旧 `projectId`，并提供 v0.1 → v0.2 升级函数；
- v0.1 与 v0.2 数据均可继续校验和读取。

### 2. Provider Registry 与能力矩阵

首批登记：ChatGPT、Gemini、DeepSeek、Grok、千问、豆包、智谱清言、Z.ai、Claude、Perplexity，以及通用网页模式。

每个平台分别声明当前可见内容、结构化当前对话、全部历史、项目与空间、附件、分支、批量选择和官方导入能力。未验证能力保持 `planned`、`unknown`、`visible-only` 或 `unsupported`，不使用一个笼统的“已支持”掩盖差异。

### 3. 通用可见内容采集

- 对已识别 AI 对话页读取当前 DOM 中已显示的消息；
- 对未知网页提供用户主动触发的“尝试通用网页对话模式”；
- 未识别页面不会自动被当成 AI 对话；
- `x.com` 普通页面不会误判为 Grok 会话；
- 结果标记为 `VISIBLE_ONLY` 和 `PARTIAL`；
- 不宣称包含隐藏历史、分支、工具事件或附件原文件；
- 重复出现的相同文本消息不会仅因文本相同而被静默删除。

### 4. 会话篮子

新增独立页面 `basket.html`：

- 读取 ChatGPT 普通、归档和 Project 会话目录；
- 搜索会话标题；
- 按项目与空间、普通/归档范围筛选；
- 以完整会话为单位勾选；
- 全选当前筛选结果、清空、逐项移除；
- 保存选择集；
- 选择附件仅记录引用或同时下载；
- 创建可暂停、可恢复的 `selected-conversations` 任务；
- 逐条写入 IndexedDB；
- 失败会话不使已完成内容失效；
- 复用既有低内存 ZIP 分卷构建。

### 5. 数据库与任务迁移

- IndexedDB Schema 从 8 升级到 9；
- 新增 `conversationSelections` Store；
- 旧备份、资料库、Project State、Memory 和 Snapshot Store 保持原位；
- 旧任务迁移时保留 Provider 和选择任务信息。

### 6. 产品文案迁移

- 当前对话入口改为“当前 AI 对话”；
- 备份中心明确当前高保真历史 Adapter 为 ChatGPT；
- Project 的通用展示逐步迁移为“项目与空间”；
- 新增“会话篮子”入口；
- 清理本轮触及页面中的历史 ContextVault 用户可见品牌。

## 明确未完成

- Gemini、DeepSeek 等平台的结构化当前对话 Adapter；
- Gemini Takeout、DeepSeek 官方历史包导入；
- 其他平台的账号全部历史抓取；
- 各平台原生左侧栏复选框注入；
- 跨平台在线会话目录聚合；
- 真实登录态浏览器端到端验收；
- Memory Gate v1。

这些内容进入 v0.13.2 或后续版本，不计入本版本完成状态。

## 后续顺序

1. v0.13.2 Gemini + DeepSeek Pilot，并评估原生侧栏多选注入；
2. v0.14.0 Memory Gate v1，基于平台中立 Schema 处理记忆准入；
3. v0.14.1 Unified Capture / Note / Stellar Graph Contract；
4. v0.15.0 Verified Handoff v1。
