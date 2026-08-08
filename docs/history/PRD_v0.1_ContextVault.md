# ContextVault 产品需求文档 v0.1

## 1. 产品定义

ContextVault 是一套本地优先的 AI 对话资产系统。首个支持平台为 ChatGPT，首个交付载体为 Chrome / Edge 扩展与可测试的 Core CLI。

它解决三个连续问题：

1. 对话能否完整、可验证地保存；
2. 历史内容能否快速检索和重新组织；
3. 新的 ChatGPT、Codex 或本地 Agent 能否在有限 Token 内可靠接管项目。

## 2. 第一目标用户

拥有大量 ChatGPT 对话、Projects、附件和长期项目记录的重度用户，包括开发者、内容创作者、研究者、学生和多 Agent 工作流使用者。

## 3. 核心原则

### 3.1 默认零 Token

以下功能必须通过确定性程序完成：

- 会话采集、解析和图遍历；
- 原始 JSON、标准化 JSON、Markdown 和 HTML 渲染；
- 哈希、去重、完整性统计；
- SQLite FTS5 全文检索；
- 按项目、日期、角色和关键词生成基础接力材料。

### 3.2 Evidence / Derived 分层

Evidence Layer 保存原始响应、完整会话图、附件、引用、时间和采集来源。只追加，不静默改写。

Derived Layer 保存 Markdown、索引、摘要、标签、项目状态、决策和 Agent 接力包。允许重新生成和版本化。

### 3.3 完整性优先

任务状态只能是：

- `COMPLETE`：所有关键计数闭合；
- `PARTIAL`：存在明确失败项；
- `FAILED`：核心路径未完成。

不得把部分导出显示为完整成功。

## 4. 核心使用场景

### 场景 A：即时保存当前长会话

用户打开一条长会话，点击导出。系统无需用户复制 Bearer Token，通过临时 Debugger Network 捕获取得完整当前会话响应，保存原始 JSON 并导出 Markdown。

### 场景 B：全历史备份

系统分页获取普通聊天、归档聊天、Projects 及已支持的资产类型。任务支持暂停、恢复、重试和增量同步。

### 场景 C：本地检索

用户可按标题、正文、项目、日期、角色、文件名和来源查找历史内容，并打开原始上下文。

### 场景 D：Agent 接力

用户给出项目、目标和 Token 预算。系统生成带证据索引的 Context Pack，供 Codex、ChatGPT 或其他 Agent 使用。

## 5. 功能优先级

## P0：当前会话可靠导出

- Chrome 与 Edge Manifest V3 扩展；
- 当前 ChatGPT 会话识别；
- `chrome.debugger` 临时附加；
- Network 监听与页面刷新；
- 捕获完整 Conversation 对象；
- 原始响应优先落盘；
- 保存完整 `mapping`、`current_node`、节点和边关系；
- 标准化为 Canonical Schema；
- 导出原始 JSON、标准化 JSON、Markdown；
- 成功、失败、超时均自动 detach；
- 生成 `integrity-report.json`；
- 处理重复点击、多标签页、错误会话、DevTools 占用、刷新失败、下载失败和结构变化。

### P0 验收

1. 一条包含至少 100 轮消息的长会话，无需滚动即可导出。
2. 原始 JSON 中保留完整 `mapping`，不是只有 `role + text`。
3. Markdown 消息数量与当前激活路径数量一致。
4. 调试器在成功、失败和超时后均断开。
5. 报告明确显示捕获、标准化和导出数量。
6. 任何失败项使状态变为 `PARTIAL` 或 `FAILED`。

## P1：全历史与 Projects

- 普通聊天、归档聊天、Projects；
- 指定会话、指定项目、日期范围；
- 分页、限流、429 重试；
- 断点续传、暂停、恢复、取消；
- 增量同步；
- 图片、用户附件、Canvas、Deep Research 等逐类支持；
- `verify`、`refetch-missing`、`rebuild-index`、`re-render`。

### P1 验收

- 中断后重启不重复下载已确认完成的会话；
- 本地进度记录与磁盘文件相互校验；
- 每种资产类型独立统计成功和失败；
- 多账户与工作区信息不会混入同一任务。

## P1：本地资产仓

- SQLite 数据库与 FTS5；
- 项目、会话、消息、分支、资产、引用和导出任务表；
- 本地项目视图、全文搜索和过滤；
- 官方 `conversations.json` 导入；
- 多次同步去重；
- 原始层与衍生层分目录。

## P2：只读 Agent 接入

首版 MCP / API 工具：

- `search_messages`
- `read_conversation`
- `list_projects`
- `get_project_snapshot`
- `get_source_evidence`
- `build_context_pack`

Agent 不得直接修改项目正史。写操作只能以 `propose_*` 形式进入用户审核队列。

## 6. Context Pack

标准输出：

```text
context-pack/
├── manifest.json
├── current-state.md
├── confirmed-decisions.md
├── constraints.md
├── failed-attempts.md
├── open-questions.md
├── next-actions.md
└── evidence/source-index.json
```

提供 2K、8K、32K 与 Full Evidence 四档预算。

## 7. 非功能需求

### 隐私

- Local-first；
- 默认无云端上传；
- Token、Cookie 不写日志；
- 不长期保存 Bearer Token；
- 测试 Fixture 不包含真实私人对话；
- Agent 按项目授权。

### 可靠性

- 原始响应先落盘；
- 临时文件写完后原子替换；
- 输出带哈希；
- Schema 变化可检测；
- 任务可恢复；
- 失败清单不可被成功摘要吞掉。

### 性能

- 不一次性把全部历史载入内存；
- 大文件和附件流式处理；
- 避免超大 Base64 Data URL；
- 增量索引与增量 AI 缓存。

## 8. 明确延后

首版不开发：多平台、云端账户、团队协作、移动端、Notion 双向同步、全量自动向量化、本地大模型、复杂知识图谱、自动修改项目正史和商业订阅系统。
