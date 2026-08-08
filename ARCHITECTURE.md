# ContextVault 技术架构 v0.1

## 1. 架构目标

系统必须允许 ChatGPT 页面、内部 API 和官方导出格式独立变化，同时保证存储、渲染、搜索和 Agent 接口不被连带重写。

## 2. 总体结构

```text
ChatGPT Browser
    │
    ├─ Debugger Network Adapter
    ├─ Internal API Adapter
    ├─ DOM Fallback Adapter
    └─ Official Export Adapter
             │
             ▼
       Raw Evidence Store
             │
             ▼
      Canonical Normalizer
             │
     ┌───────┼────────┐
     ▼       ▼        ▼
 Renderers  Integrity  SQLite/FTS
     │       │        │
     └───────┼────────┘
             ▼
       Context Compiler
             │
        MCP / REST / CLI
```

## 3. 推荐 Monorepo

```text
context-vault/
├── apps/
│   ├── cli/
│   ├── extension/
│   ├── local-web/
│   └── mcp-server/
├── packages/
│   ├── domain/
│   ├── chatgpt-debugger-adapter/
│   ├── chatgpt-api-adapter/
│   ├── official-export-adapter/
│   ├── dom-adapter/
│   ├── normalizer/
│   ├── renderers/
│   ├── asset-manager/
│   ├── integrity/
│   ├── storage/
│   ├── search/
│   └── context-compiler/
├── fixtures/
├── docs/adr/
├── docs/provenance/
├── licenses/
└── .agent-harness/
```

## 4. Canonical Schema 最小对象

### Conversation

- `id`
- `title`
- `sourceProvider`
- `sourceWorkspace`
- `createdAt`
- `updatedAt`
- `currentNodeId`
- `nodes`
- `edges`
- `activePath`
- `projectId`
- `metadata`
- `rawEvidenceRef`

### MessageNode

- `id`
- `parentId`
- `childIds`
- `role`
- `createdAt`
- `contentParts`
- `model`
- `status`
- `metadata`
- `assetRefs`
- `citationRefs`

### ContentPart

采用带判别字段的联合类型，至少支持：

- `text`
- `code`
- `image`
- `file`
- `citation`
- `tool_call`
- `tool_result`
- `canvas`
- `reasoning_summary`
- `unknown`

未知类型不得丢弃，保存原始 Payload 和类型名。

## 5. 四类 Adapter

### 5.1 Debugger Network Adapter

职责：当前会话即时完整捕获，无需用户复制 Token。

边界：只负责取得原始响应和当前页面身份，不负责 Markdown 渲染和长期存储。

必须验证：捕获结果中的 Conversation ID 与当前页面 ID 一致。

### 5.2 Internal API Adapter

职责：全历史、归档、Projects、附件、断点续传和限流。

边界：接口属于非官方依赖，必须隔离在单独包内，并提供 Schema 变化错误。

### 5.3 Official Export Adapter

职责：导入 OpenAI 官方 ZIP / `conversations.json`，作为稳定恢复路径。

### 5.4 DOM Adapter

职责：选择性消息导出、当前显示效果恢复和紧急降级。不得作为全量备份唯一来源。

## 6. 原始证据存储

建议结构：

```text
vault/
├── raw/chatgpt/{account_hash}/{conversation_id}/
│   ├── response.json
│   └── capture-manifest.json
├── normalized/
├── assets/
├── exports/
├── reports/
├── context-packs/
└── context-vault.sqlite
```

`capture-manifest.json` 记录：Adapter、版本、捕获时间、页面 URL、账户哈希、工作区哈希、响应哈希和解析状态。

## 7. 完整性引擎

每次运行生成以下计数：

- listed
- fetched
- normalized
- rendered
- failedConversations
- expectedAssets
- downloadedAssets
- failedAssets
- duplicateIds
- orphanNodes
- unknownContentTypes

状态判定必须由程序计算，不由 UI 自行决定。

## 8. Token 与 AI 层

L0：采集、解析、检索、渲染、校验，零 Token。

L1：SQLite FTS5，零 Token。

L2：可选 Embedding，按内容哈希增量缓存。

L3：单会话或少量片段结构提取。

L4：用户主动触发的跨项目综合。

缓存键：

```text
source_content_hash + task_type + prompt_version + model_id + parser_version
```

## 9. 第一阶段技术选择

- Monorepo：pnpm workspace；
- 语言：TypeScript；
- 扩展框架：WXT；
- 测试：Vitest + Playwright；
- Schema：Zod；
- ZIP：zip.js 或 fflate；
- 本地数据库：SQLite；
- UI：React；
- CLI：Node.js；
- 后期桌面壳：Tauri，可延后。

## 10. 架构决策

### ADR-001：新建 Monorepo

不长期 Fork 任一单一上游。原因是五个上游分别擅长不同器官，直接选一个作为主仓会把系统锁进其历史边界。

### ADR-002：CLI 先于复杂 UI

先用 Fixture 和 CLI 验证 Schema、Normalizer、Renderer 与 Integrity，再接浏览器 UI。

### ADR-003：原始响应优先

捕获成功后先保存 Raw Evidence，再开始标准化和渲染。任何衍生失败都不能导致原始数据丢失。

### ADR-004：Agent 先只读

MCP 第一阶段只允许搜索、读取和生成 Context Pack。写入项目状态必须等待审核机制完成。

## ADR-005：Editable Content 与 Raw Evidence 分层

`content-objects` 继续作为不可变原始证据对象仓。可编辑笔记、闪念、摘录和文件记录存入独立 `capture-*` stores，并通过稳定 Evidence URI 引用证据。

原则：

- Raw Evidence 不因笔记编辑、归档或回收而改变；
- 每次编辑生成不可变版本和操作日志；
- 乐观 revision 检查阻止静默覆盖；
- 关系独立存储，不嵌入正文；
- 晋升到 Memory / Decision / Task 必须形成待审核草案；
- Agent Bundle 可以读取当前对象及历史，但 Agent 第一阶段仍不得直接写回；
- 后续同步和恢复必须基于操作日志、哈希和冲突回执，不允许整库盲覆盖。

## ADR-006：Portable Capture 恢复必须先验证、后原子写入

Agent Bundle 是只读接力包，不是浏览器数据恢复格式。可编辑 Capture / Note 数据使用独立 Portable Capture Package。

原则：

- 包内记录排序、哈希和 scope 必须确定性生成；
- 导入前执行零写入 dry run，校验 payload、对象、版本、Evidence、关系端点与 Project scope；
- Project、revision、lineage 或不可变 ID 冲突必须阻止整次写入，不允许 best-effort 部分恢复；
- 相同记录跳过，安全快进必须证明输入历史包含本地精确 revision/hash；
- 每次 apply 和 rollback 生成 append-only receipt；
- rollback 只撤销 receipt 明确边界，后续编辑或新依赖出现时必须阻止；
- Raw Evidence、approved Project State、凭证和二进制附件不属于该恢复写入域。

## Verified Handoff transaction layer (v0.15.0)

```text
Source Agent Bundle
  → select exactly one Project
  → approved State + Memory Gate + Context Pack + public Benchmark
  → Receiver Package ───────────────→ receiver preflight → fresh Agent context
  → Private Verification Kit (kept) ← receiver receipt + final response
                                      → deterministic post-run verification
```

The receiver package and private answer key are separate artifacts. Preflight validates hashes, declared entries, Project scope and State/Bundle/Gate/Benchmark cross-links before materialization. Post-run verification produces a failure taxonomy and never approves or mutates Project State. SHA-256 provides integrity; v1 does not authenticate signer identity.

## v0.16.0 Notes PWA boundary

`apps/pwa` is a separate mobile-first reading/editing surface. It stores editable Capture objects in `kv-archive-notes` IndexedDB and imports/exports through the v0.14.3 Portable Capture contract. It does not share or mutate the extension's immutable Raw Evidence database directly.

The PWA's application shell is cached by a service worker. Offline availability covers the local shell and local data operations; it does not imply background synchronization. Initial timeline rendering is bounded, with explicit incremental loading to avoid rendering the entire local corpus on weak devices.

## Unified task feedback layer (v0.16.5)

Long-running UI operations use `apps/extension/src/task-feedback.js` and `task-feedback.css` as a presentation-only layer. Business stores and engines remain authoritative. The controller may display real counts, elapsed time and derived ETA, but it does not create checkpoints or determine completion. Unknown-duration operations remain indeterminate. Pause/error outcomes preserve the current measured portion. The layer is shared as a singleton per full-page document and compactly embedded in the popup.

## Adaptive appearance layer (v0.16.6)

Appearance is a presentation-only layer:

- `theme-bootstrap.js` resolves the saved mode before CSS loads to avoid a light/dark flash;
- `theme-manager.js` owns the public `system | light | dark` setting, OS change observation and control synchronization;
- `theme.css` maps semantic surface, text, line, control, action and feedback tokens to calibrated light/dark palettes;
- theme state is stored in local browser storage and never enters IndexedDB, Raw Evidence, Project State or export contracts.

## Visibility hardening layer (v0.16.7)

`visibility.css` is loaded after page CSS and `theme.css`. It is the final accessibility and readability contract, not a replacement for semantic theme tokens. It defines compatibility aliases, explicit control-role foreground/background pairs, typography floors and page-specific corrections discovered through Chromium computed-style audits. Native `[hidden]` semantics must override layout classes. The Notes PWA separates accent-text color from white-on-color control surfaces because a single luminance cannot satisfy both uses in dark mode.

## Scoped storage-read invariant (v0.16.10)

Project-scoped operations must scope at the storage boundary when the current schema already exposes a suitable primary key or index. Filtering a full-store `getAll()` result in JavaScript is not an acceptable default for long-lived Project export paths when `projectId` or `objectId` indexes can constrain the read.

Current examples:

- Project Agent export: Conversation/Capture by `projectId`, Project State by primary key, messages by `conversationKey`, Evidence by exact key.
- Capture/Notes Project export: current objects by `projectId`, version history by selected object IDs through `captureVersions.objectId`.

A schema bump is justified only when the current indexes cannot express the required safety/performance boundary and a migration/recovery plan exists.

PWA Service Worker/cache cleanup follows the same ownership principle: cleanup is restricted to the `kv-archive-notes-*` cache namespace and must not delete unrelated same-origin application caches.


## Incremental conversation content-object layer (v0.16.11)

Updated ChatGPT raw conversations keep the existing History Store `putArtifact()` / `getArtifact()` contract while changing physical storage for payloads containing a `mapping` graph.

```text
History artifact row
  → conversation-manifest/v2
      → conversation-map-chunk/v1 (bounded node-id → object-key references)
          → conversation-node (immutable raw mapping node payload)
```

Rules:

- each raw mapping node is keyed by content hash, so unchanged nodes are reused across conversation versions;
- reference entries are grouped into fixed-size content-addressed chunks, so an append normally rewrites only the tail reference chunk instead of a full list of every node key;
- the manifest retains non-mapping top-level raw fields and ordered mapping-chunk references; reconstruction preserves the raw graph and key order expected by existing render/export paths;
- legacy whole-conversation objects remain readable; there is no eager migration of old snapshots or artifacts;
- first post-upgrade modification of a legacy conversation seeds node/chunk objects, while subsequent modifications can reuse them;
- Content Snapshot GC expands `references` transitively before deleting content objects, protecting manifest → reference-chunk → node dependencies;
- Extension IndexedDB remains version 13.

This optimization reduces repeated physical writes. Detecting an updated conversation still requires fetching/hashing that conversation's latest raw graph because the upstream ChatGPT history API does not expose a trusted per-message delta contract in this implementation.
