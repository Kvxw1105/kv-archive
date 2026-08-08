# TASK-015 — v0.12.2 最后一公里体验

Status: COMPLETED_LOCALLY_VERIFIED

## Principal acceptance target

让第一次使用 KV Archive 的用户不需要理解内部模块，就能完成：保存当前对话、确认数据保存位置、继续备份、处理错误，并看懂 Obsidian 导出是否可用。

## Scope

1. Popup 状态感知推荐与一键保存。
2. 当前对话默认写入本地资料库，下载文件作为可选动作。
3. 导出完成后提供打开资料库与显示下载文件的下一步。
4. 备份健康卡、浏览器/电脑三层状态与启动前预检。
5. 高频错误提供行动按钮。
6. Obsidian 质量门先给用户结论，再展示技术指标。

## Protected behavior

- 不改变数据库版本和现有数据含义。
- 不删除 Raw Evidence。
- 不改变全量备份、定时备份、分卷和恢复算法。
- 不降低技术报告与高级控制能力。

## Verification

- typecheck
- extension build
- unit/integration suite
- UI static regression tests
- package manifest/version validation

## Deferred

- 真实 Chrome 账号验收
- 多账号/多窗口标签选择实测
- 真实下载目录“显示文件”操作实测

## Completion evidence

- version: 0.12.2
- `npm test`: 147/147 passed
- `npm run typecheck`: passed
- extension, core and Agent Bridge builds: passed
- archive and Obsidian performance smokes: passed
- real Chrome and Obsidian acceptance: pending
