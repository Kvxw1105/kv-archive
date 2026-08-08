# KV Archive v0.13.0｜Continuity Benchmark

## 版本目标

让“Agent 接力成功”从主观感觉变成一份可以重复执行、可以留档、可以比较的验证结果。

KV Archive 以前已经能够生成 Agent Bundle、Context Pack 和项目状态。v0.13.0 增加第一层接管评测：项目所有者生成挑战，接收方 Agent 回答，发送方用私有答案键评分。评分不调用模型，也不会修改项目正史。

## 本次实现

### 1. 挑战包与私有答案键分离

`benchmark-create` 生成四个文件：

- `PROMPT.md`：交给接收方 Agent 的任务说明；
- `benchmark-challenge.json`：公开的项目、版本、评分维度和响应约束；
- `response-template.json`：接收方必须返回的结构；
- `benchmark-answer-key.json`：发送方保留的私有答案键。

公开挑战不包含状态摘要、决策、任务、阻塞和下一步的答案。

### 2. 七类接管信息

接收方需要准确返回：

- Project ID 与标题；
- 当前摘要、阶段、健康状态和进度；
- 当前有效决策；
- 未完成任务；
- 阻塞；
- 下一步；
- 可验证的 `contextvault://` Evidence URI。

缺少的信息应使用 `null`、空数组和 `uncertainties` 明示，不鼓励猜测。

### 3. 100 分确定性评分

当前评分权重：

- 项目身份：10 分；
- 当前状态：20 分；
- 有效决策：20 分；
- 未完成任务：20 分；
- 阻塞和下一步：15 分；
- 证据引用：15 分。

`PASS` 需要达到 85 分，并且不存在关键错误。

以下情况会直接阻止 Verified PASS：

- Project ID 错误；
- 编造不存在的 Decision ID；
- 编造不存在的 Task ID；
- 引用无效 Evidence URI。

### 4. CLI 闭环

创建挑战：

```bash
node apps/agent-bridge/dist/agent/index.js benchmark-create \
  --bundle /path/to/KV-Archive-Agent-Bundle.zip \
  --project "AtlasDemo" \
  --output ./benchmark-run
```

评分：

```bash
node apps/agent-bridge/dist/agent/index.js benchmark-score \
  --bundle /path/to/KV-Archive-Agent-Bundle.zip \
  --benchmark ./benchmark-run/benchmark-answer-key.json \
  --response ./agent-response.json \
  --output ./benchmark-report
```

输出包括 `continuity-report.json` 和 `continuity-report.md`。

### 5. 跨平台辅助脚本

Agent Bridge 包新增：

- `create-benchmark.sh` / `create-benchmark.cmd`；
- `score-benchmark.sh` / `score-benchmark.cmd`。

旧的 `context-vault-agent` 命令别名继续保留，新命令为 `kv-archive-agent`。

### 6. Agent Bundle 标记

Agent Bundle Manifest 新增 `continuityBenchmarkVersion: 1`，并包含 `CONTINUITY_BENCHMARK.md` 使用说明。

## 工程边界

- 不修改浏览器数据库版本；
- 不修改 Raw Evidence；
- 不修改备份、分卷、快照和恢复算法；
- 不调用远程模型；
- 不让接收方 Agent读取私有答案键；
- 当前评分主要依据已审核 Project State 和 Bundle 中的 Evidence；
- 当前版本没有对自由文本做模型语义评审，也没有在扩展 GUI 中加入评测页面。

## 后续关系

Continuity Benchmark 是后续两个能力的基线：

1. `Memory Gate` 决定哪些记忆可以进入接力上下文；
2. `Verified Handoff` 将生成、交付、回答、评分和接管报告串成一键流程。
