import { createContinuityBenchmark, evaluateContinuityResponse } from "./continuity-benchmark.js";

function clean(value, max = 20000) { return String(value ?? "").trim().slice(0, max); }

function dimensionMap(report) {
  return new Map((report?.dimensions || []).map((row) => [row.id, row]));
}

function failureTaxonomy(report) {
  const text = [...(report?.criticalIssues || []), ...(report?.issues || [])].join("\n");
  const rows = [];
  if (/Project ID/i.test(text)) rows.push("WRONG_PROJECT_ID");
  if (/Unsupported decision/i.test(text)) rows.push("UNSUPPORTED_DECISION");
  if (/Unsupported task/i.test(text)) rows.push("UNSUPPORTED_TASK");
  if (/Invalid evidence/i.test(text)) rows.push("INVALID_EVIDENCE_URI");
  if (/Missing decision/i.test(text)) rows.push("MISSING_DECISION");
  if (/Missing task/i.test(text)) rows.push("MISSING_TASK");
  if (/No evidence URI/i.test(text)) rows.push("MISSING_EVIDENCE");
  if (/Unsupported blockers/i.test(text)) rows.push("UNSUPPORTED_BLOCKER");
  if (/Unsupported next actions/i.test(text)) rows.push("UNSUPPORTED_NEXT_ACTION");
  return rows;
}

export function createMemoryGateBenchmarkExperiment(repository, options = {}) {
  const project = clean(options.project || options.projectId || options.projectTitle, 500);
  if (!project) throw new Error("project is required");
  const query = clean(options.query || "Continue the current project accurately", 2000);
  const budgetTokens = [2048, 8192, 32768].includes(Number(options.budgetTokens)) ? Number(options.budgetTokens) : 8192;
  const gatePolicy = ["safe", "balanced", "broad"].includes(options.gatePolicy) ? options.gatePolicy : "balanced";
  const gateBudgetTokens = Math.max(256, Math.min(Number(options.gateBudgetTokens || Math.floor(budgetTokens * 0.35)), budgetTokens - 256));
  const generatedAt = options.generatedAt || new Date().toISOString();
  const benchmark = createContinuityBenchmark(repository, { project, generatedAt });
  const off = repository.buildContextPack({ project, projectTitle: project, query, budgetTokens, generatedAt });
  const on = repository.buildContextPack({ project, projectTitle: project, query, budgetTokens, memoryGatePolicy: gatePolicy, memoryGateBudgetTokens: gateBudgetTokens, generatedAt });
  const experimentId = `${benchmark.challenge.benchmarkId}-gate-${gatePolicy}`;
  return {
    format: "kv-archive-memory-gate-benchmark-experiment",
    version: 1,
    experimentId,
    generatedAt,
    project: benchmark.challenge.project,
    query,
    budgetTokens,
    gatePolicy,
    gateBudgetTokens,
    benchmark,
    packs: {
      off: { markdown: off.markdown, estimatedTokens: off.estimatedTokens, sources: off.selectedExcerpts },
      on: { markdown: on.markdown, estimatedTokens: on.estimatedTokens, sources: on.selectedExcerpts, memoryGate: on.memoryGate || null },
    },
  };
}

export function compareMemoryGateBenchmarkResponses(repository, answerKey, responseOff, responseOn, options = {}) {
  const off = evaluateContinuityResponse(repository, answerKey, responseOff).report;
  const on = evaluateContinuityResponse(repository, answerKey, responseOn).report;
  const offDimensions = dimensionMap(off);
  const onDimensions = dimensionMap(on);
  const dimensions = [...new Set([...offDimensions.keys(), ...onDimensions.keys()])].sort().map((id) => {
    const left = offDimensions.get(id) || { label:id, score:0, maxScore:0 };
    const right = onDimensions.get(id) || { label:id, score:0, maxScore:0 };
    return { id, label:right.label || left.label, off: left.score, on: right.score, maxScore: right.maxScore || left.maxScore, delta: Math.round((right.score-left.score)*100)/100 };
  });
  const scoreDelta = Math.round((on.score - off.score) * 100) / 100;
  const report = {
    format: "kv-archive-memory-gate-benchmark-comparison",
    version: 1,
    experimentId: clean(options.experimentId, 500) || `${answerKey.benchmarkId}-comparison`,
    benchmarkId: answerKey.benchmarkId,
    generatedAt: options.generatedAt || new Date().toISOString(),
    project: answerKey.project,
    off: { score:off.score, verdict:off.verdict, verified:off.verified, criticalIssues:off.criticalIssues, issues:off.issues, taxonomy:failureTaxonomy(off) },
    on: { score:on.score, verdict:on.verdict, verified:on.verified, criticalIssues:on.criticalIssues, issues:on.issues, taxonomy:failureTaxonomy(on) },
    scoreDelta,
    verdictChanged: off.verdict !== on.verdict,
    dimensions,
    improvedDimensions: dimensions.filter((row)=>row.delta>0).map((row)=>row.id),
    regressedDimensions: dimensions.filter((row)=>row.delta<0).map((row)=>row.id),
    conclusion: scoreDelta > 0 ? "IMPROVED" : scoreDelta < 0 ? "REGRESSED" : "NO_CHANGE",
  };
  const markdown = [
    "# Memory Gate Continuity Benchmark Comparison", "",
    `- Project: ${report.project.title} (${report.project.id})`,
    `- Benchmark: ${report.benchmarkId}`,
    `- Gate off: **${off.score}/100 · ${off.verdict}**`,
    `- Gate on: **${on.score}/100 · ${on.verdict}**`,
    `- Delta: **${scoreDelta >= 0 ? "+" : ""}${scoreDelta}**`,
    `- Conclusion: **${report.conclusion}**`, "",
    "## Dimension delta", "",
    ...dimensions.map((row)=>`- ${row.label}: ${row.off} → ${row.on} (${row.delta>=0?"+":""}${row.delta})`), "",
    "## Failure taxonomy", "",
    `- Gate off: ${report.off.taxonomy.join(", ") || "None"}`,
    `- Gate on: ${report.on.taxonomy.join(", ") || "None"}`, "",
    "## Interpretation boundary", "",
    "- This comparison measures the supplied Agent responses. It does not claim a universal model-quality improvement.",
    "- A regression must be investigated before making Memory Gate the default for that workflow.", "",
  ].join("\n");
  return { report, markdown, offReport:off, onReport:on };
}
