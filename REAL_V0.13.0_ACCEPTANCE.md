# KV Archive v0.13.0 真实接力验收

Status: REAL_AGENT_ACCEPTANCE_PENDING

## 前置条件

1. 使用真实 KV Archive 资料库导出一个只包含目标 Project 的 Agent Bundle；
2. Project State 至少包含当前阶段、一个有效决策或一个未完成任务；
3. 使用独立目录保存挑战和报告；
4. 不把 `benchmark-answer-key.json` 提供给接收方 Agent。

## A. 创建挑战

运行：

```bash
create-benchmark.cmd "D:\path\KV-Archive-Agent-Bundle.zip" "项目名" "D:\path\benchmark-run"
```

期望：

- 四个文件全部生成；
- `benchmark-challenge.json` 中不出现真实状态答案；
- `benchmark-answer-key.json` 中包含当前已审核状态；
- 同一 Bundle 和 State 重复创建时 Benchmark ID 一致；
- 项目不存在时明确失败，不产生伪造挑战。

## B. 独立 Agent 回答

只向接收方提供：

- Agent Bundle；
- Agent Bridge 或 MCP 配置；
- `PROMPT.md`；
- `benchmark-challenge.json`；
- `response-template.json`。

要求接收方将最终 JSON 保存为 `agent-response.json`。

重点观察：

- 是否使用正确 Project；
- 是否区分当前有效决策和已废弃内容；
- 是否正确识别未完成任务、阻塞和下一步；
- 是否引用真实 Evidence URI；
- 不确定时是否明确说明，而非补造答案。

## C. 评分

运行：

```bash
score-benchmark.cmd "D:\path\KV-Archive-Agent-Bundle.zip" "D:\path\benchmark-run\benchmark-answer-key.json" "D:\path\agent-response.json" "D:\path\benchmark-report"
```

期望：

- 生成 JSON 与 Markdown 报告；
- 完全正确回答达到 100 分；
- 错误 Project ID 直接 FAIL；
- 添加虚构 Decision/Task ID 直接 FAIL；
- 添加伪造 Evidence URI 直接 FAIL；
- 缺少部分内容时给出 PARTIAL 或低分 FAIL，不显示 Verified PASS。

## D. 对比评测

至少使用两个不同 Agent 或两个不同 Context Pack 版本回答同一挑战，记录：

- Agent / 模型；
- Context Pack Token 档位；
- 总分；
- 各维度分数；
- Critical issues；
- 实际接管后是否发生误操作。

这批真实数据将用于后续 Memory Gate 和 Verified Handoff 的阈值校准。

## 当前未覆盖

- 自由文本答案自动解析；
- 模型语义评分；
- 浏览器 GUI 一键发起评测；
- 跨多 Project 联合接力；
- 对无已审核 Project State 的深层事实自动出题。
