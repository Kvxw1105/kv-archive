# KV Archive v0.16.8 — Task Feedback Coverage Completion

状态：`LOCALLY_VERIFIED`

本版补齐剩余高等待感任务的反馈链路：10 分钟增量验收秒级倒计时、备份只读预检、验收诊断报告、清理本轮缓存、资料库搜索、长对话详情，以及 Notes PWA 的恢复包导出、干运行、写入和安全回滚。

## 真实反馈原则

- 有明确总量时显示真实计数和百分比。
- 无法估算时显示阶段与持续运行态，不伪造百分比。
- 定时等待使用真实截止时间计算倒计时。
- 短操作只使用按钮忙碌态，不制造多余进度条。

## 兼容性

不修改数据库版本、Raw Evidence、Project State、Memory Gate、Portable Capture 格式或 Agent Bundle 格式。
