# ContextVault 首批 Issue 队列

## Milestone M0：Repository Foundation

### CV-001 初始化 pnpm Monorepo

目标：建立 `apps/`、`packages/`、`fixtures/`、`docs/` 和 `.agent-harness/`。

验收：安装、类型检查、测试和构建命令可从根目录执行；无业务功能。

### CV-002 锁定五个 A 级上游

目标：完成精确 Commit、License、模块映射和来源说明。

验收：`UPSTREAMS.lock.json` 不含 `TO_PIN_BEFORE_IMPORT`。

### CV-003 定义 Canonical Schema v0.1

目标：使用 TypeScript + Zod 定义 Conversation、MessageNode、ContentPart、Asset、Citation 和 CaptureManifest。

验收：未知内容类型可保存原始 Payload，不因未识别类型解析失败。

### CV-004 建立 Golden Fixtures

目标：创建合成短会话、长会话、多分支、代码、公式、工具消息和未知内容类型 Fixture。

验收：Fixture 不含真实私人数据，并有预期统计清单。

## Milestone M1：Deterministic Core

### CV-005 实现 Debugger Raw Response Parser

借鉴：yesooner 的 `decodeResponseBody`、候选 JSON 解析和 Conversation 对象识别。

验收：支持普通 JSON、Base64、SSE 行和嵌套 JSON 字符串。

### CV-006 实现 Conversation Graph Normalizer

验收：保存全图、当前节点、激活路径、孤立节点和未知类型；不会只输出当前分支文本。

### CV-007 实现 Markdown Renderer

验收：用户、助手、系统、代码、Mermaid、行内与块级 LaTeX 可稳定输出；Golden Snapshot 通过。

### CV-008 实现 Integrity Engine

验收：可生成 listed / fetched / normalized / rendered / failed / orphan / unknown 等统计并计算状态。

### CV-009 实现 Core CLI

命令建议：

```text
context-vault import <raw.json>
context-vault normalize <raw.json>
context-vault render <canonical.json>
context-vault verify <run-dir>
```

## Milestone M2：Current Conversation Extension

### CV-010 创建 WXT 扩展壳

验收：Chrome 和 Edge 开发模式可加载，权限与用途清晰显示。

### CV-011 实现 Debugger Capture Lifecycle

验收：主动点击后 attach；成功、失败、超时后 detach；重复点击被阻止；不同标签页任务隔离。

### CV-012 验证捕获会话身份

验收：页面 Conversation ID 与捕获对象不一致时拒绝保存并报告风险。

### CV-013 原始响应优先持久化

验收：Normalizer 或 Renderer 失败时，Raw Evidence 仍存在且可重试。

### CV-014 下载与文件系统策略

验收：小文件可直接下载；大文件不使用超大 Base64 Data URL；失败可重试。

### CV-015 浏览器 E2E

覆盖：短会话、长会话、超时、DevTools 占用、错误响应、页面切换和重复点击。

## Milestone M3：Bulk Backup

### CV-016 Internal API Transport
### CV-017 Conversation Pagination
### CV-018 Archived Conversations
### CV-019 Projects
### CV-020 Progress and Resume
### CV-021 Adaptive Throttle
### CV-022 Verify and Refetch
### CV-023 First Asset Type End-to-End

## Milestone M4：Local Vault

### CV-024 SQLite Schema
### CV-025 FTS5 Index
### CV-026 Official Export Import
### CV-027 Incremental Sync and Deduplication
### CV-028 Local Search UI

## Milestone M5：Agent Read Layer

### CV-029 MCP Server Skeleton
### CV-030 Search and Read Tools
### CV-031 Project Snapshot
### CV-032 Token-budget Context Compiler
### CV-033 Evidence Source Index
