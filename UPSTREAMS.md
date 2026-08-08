# ContextVault 开源源码复用清单 v0.1

## 1. 复用原则

- 不从零重写成熟基础能力；
- 不把多个仓库直接复制粘贴到一个目录；
- 先锁定精确 Commit、License 和目标模块；
- 复用代码必须进入统一接口并补齐测试；
- 页面选择器和非官方 API 代码视为高变动区；
- 原始代码中的产品边界不自动继承。

## 2. A 级核心母本

### 2.1 yesooner/chatgpt-conversation-export-extension

仓库：https://github.com/yesooner/chatgpt-conversation-export-extension

当前已核验基准 Commit：`9eb0dfe9a6bd9173a53db5ac1cac7caefa8744e2`

License：MIT

主要价值：

- `chrome.debugger` 临时捕获当前 ChatGPT 页面网络响应；
- 免用户手工复制 Bearer Token；
- 绕开虚拟化 DOM；
- 当前分支回溯；
- Mermaid、LaTeX 和代码块 DOM 处理；
- 调试器超时与 detach 生命周期。

建议落点：`packages/chatgpt-debugger-adapter`

需要重构：

- 原始响应优先保存，不能立即压平为 `role + text`；
- 保存完整分支图；
- 增强 Conversation ID 验证；
- 替换大文件 Base64 Data URL 下载；
- 建立 Fixture 和 E2E 测试；
- 将捕获、解析、标准化和渲染解耦。

### 2.2 brianjlacy/export-chatgpt

仓库：https://github.com/brianjlacy/export-chatgpt

当前已核验基准 Commit：`4cfc3f235ad41c864e7fe2369fb0037875537dbd`

License：MIT

Batch 1–2 使用方式：参考公开工程规格中的普通、归档、Projects 接口、分页、文件元数据和进度思想；ContextVault 历史引擎、空间选择、迁移和 ZIP 索引为独立实现，未复制上游源码文件。

主要价值：

- 全历史分页；
- 普通聊天与 Projects；
- 归档会话；
- 图片、Canvas、附件、Deep Research；
- 断点续传；
- 自适应限流；
- `verify` 与 `refetch-missing`。

建议落点：`packages/chatgpt-api-adapter`

需要重构：

- 网络协议、认证、进度和文件存储解耦；
- 移除 CLI 对核心逻辑的绑定；
- 不把 Token 写入日志或长期存储；
- 输出 Canonical Schema，而非直接面向文件布局。

### 2.3 pionxzh/chatgpt-exporter

仓库：https://github.com/pionxzh/chatgpt-exporter

Commit：`TO_PIN_BEFORE_IMPORT`

License：MIT

主要价值：

- Markdown AST；
- HTML、PNG、JSON、ZIP；
- KaTeX、GFM、Frontmatter；
- 国际化；
- 成熟的导出交互。

建议落点：`packages/renderers` 与扩展 UI 参考。

注意：现有 `test` 主要是 TypeScript 类型检查，复用后必须补行为测试。

### 2.4 FredySandoval/ChatGPT-CHROME_EXTENSION

仓库：https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION

Commit：`TO_PIN_BEFORE_IMPORT`

License：MIT

主要价值：

- WXT + React + TypeScript；
- Manifest V3 工程壳；
- 当前、全部与 Project 导出入口；
- 进度、停止和设置页；
- zip.js。

建议落点：`apps/extension`

注意：借工程结构和交互，不直接继承其数据模型。

### 2.5 slyubarskiy/chatgpt-conversation-extractor

仓库：https://github.com/slyubarskiy/chatgpt-conversation-extractor

Commit：`TO_PIN_BEFORE_IMPORT`

License：MIT

主要价值：

- 官方 `conversations.json` 导入；
- 会话图回溯；
- 防御性解析；
- 项目识别；
- Schema 演化和失败日志；
- 大规模数据处理经验。

建议落点：`packages/official-export-adapter`

注意：其默认目标不是完整取证保存，会过滤部分隐藏、工具和修订内容。只能借图处理与错误恢复，不能把其输出作为唯一母数据。

## 3. B 级专项参考

- `amazingpaddy/ai-chat-exporter`：选择性消息、多平台、公式和表格。
- `revivalstack/ai-chat-exporter`：多平台 Adapter、YAML Frontmatter、TOC。
- `BluePhoenix/ChatGPT-Export-Tools`：官方导出、Markdown / CSV、SQLite 搜索。
- `Scarvy/chatgpt-to-sqlite`：官方导出进入 SQLite。
- `queelius/ctk`：多平台统一导入、树形数据和 JSONL。
- `sho7650/obsidian-AI-exporter`：Obsidian Local REST。
- `gavi/chatgpt-markdown`：Obsidian Markdown。
- `selberhad/chatgpt-export-viewer`：本地查看和搜索。
- `rashidazarang/chatgpt-chat-exporter`：Markdown / PDF、公式和媒体占位。
- `ocombe ChatGPT Conversation Exporter`：全历史与资源文件处理。

B 级仓库只针对具体问题考古，不进入首轮依赖。

## 4. 复用分级

### Level 1：可直接移植后测试

- 纯函数解析器；
- 文件名清理；
- 会话图遍历；
- 重试和退避算法；
- Markdown AST 转换；
- 哈希与去重。

### Level 2：需要适配统一接口

- Debugger 生命周期；
- Internal API 采集；
- Service Worker 任务；
- ZIP 和下载器；
- 插件 UI。

### Level 3：只参考，不直接复制

- 页面选择器；
- 手工 Bearer Token 交互；
- 把原始数据压平的模型；
- 超大 Base64 Data URL；
- 未测试的高权限流程。

## 5. Gate 0 必须完成的源码考古表

每个 A 级仓库都要记录：

- 精确 Commit SHA；
- License；
- 入口文件；
- 核心调用链；
- 可复用模块；
- 依赖和运行环境；
- 测试覆盖；
- 已知限制；
- 本地目标包；
- 修改计划；
- 上游同步策略。

## 6. Standards reference used by Batch 5

### Model Context Protocol specification 2025-06-18

Reference: https://modelcontextprotocol.io/specification/2025-06-18/

Use: protocol-level reference for JSON-RPC lifecycle, newline-delimited stdio transport, tool discovery, resources and read-only tool annotations.

Code reuse: none. ContextVault implements a small dependency-free compatibility layer and tests the wire protocol directly. The bridge intentionally remains on the stable 2025-era protocol while the 2026 SDK generation is pre-release.
