# KV Archive v0.16.10 — Handoff Truth & Scoped Storage Hardening

状态：`LOCALLY_VERIFIED`

v0.16.10 不扩展新的产品页面，重点修复两个会在长期使用后放大的基础问题：Agent 接手源码时看到的项目状态已经失真，以及“只导一个 Project”在部分数据层仍会先扫描整个本地库。

## 1. Agent 接力真源修复

旧根级 `AGENTS.md` 仍然把仓库描述成刚开始的 `PLANNED` 原型，`.agent-harness/CURRENT_STATE.md` 也停在 v0.16.2。新的接管 Agent 可能据此重复开发、错误重构或忽略后续已形成的数据保护区。

本版将稳定规则留在 `AGENTS.md`，把会变化的版本/节点/真实未验收项放回 `.agent-harness/CURRENT_STATE.md`，并新增 TASK-028。以后接手时应先读这两个层级，不再把早期原型规则当现状。

## 2. Project 导出真正收紧到存储层

v0.16.9 已经避免 Agent Bundle 读取整个 Message/Evidence Store，但 Project 选择之前仍有 Conversation、Capture Item 和版本历史全量读取路径。

v0.16.10 在不升级数据库的前提下复用现有索引：

- Conversation：`projectId`；
- Capture Item：`projectId`；
- Project State：主键 `projectId`；
- Capture Version：`objectId`。

因此，当用户只导出一个 Project 时，系统先从 IndexedDB 读取该 Project 的对象，再按这些对象 ID 分批读取版本历史。全库导出仍保持原有行为。

## 3. Notes PWA Cache 隔离

旧 Service Worker 激活时会删除除当前缓存之外的所有同源 Cache Storage。若未来同一域名部署多个应用，这会越界删除其他应用缓存。

现在只清理 `kv-archive-notes-*` 命名空间中的旧 KV Archive Notes 缓存，其他同源缓存保留。

## 4. 版本元数据一致性

Extension 的 Agent Bundle 和 Portable Capture builder 仍保留 v0.16.7 的默认 `sourceAppVersion`。正常 UI 会显式传 Manifest 版本，因此此前不一定产生错误文件，但遗漏参数的调用者可能写入陈旧版本。

本版把默认值统一到 v0.16.10，并同步 Extension、PWA、Agent Bridge 和 package metadata。

## 兼容性

- Extension IndexedDB：仍为 v13；
- Notes PWA IndexedDB：仍为 v1；
- 不要求重建本地资料；
- 不改变 Raw Evidence、Evidence URI、Agent Bundle、Portable Capture、Project State、Memory Gate 或恢复包 Schema。

真实 Chrome / 移动端验收仍需按 `REAL_V0.16.10_ACCEPTANCE.md` 完成。
