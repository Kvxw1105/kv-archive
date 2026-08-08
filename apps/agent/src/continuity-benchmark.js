import { createHash } from "node:crypto";
import { normalizeSearchText, tokenizeText } from "./agent-core.js";

export const CONTINUITY_BENCHMARK_VERSION = 1;
export const CONTINUITY_RUBRIC = Object.freeze({
  projectIdentity: 10,
  currentStatus: 20,
  decisions: 20,
  tasks: 20,
  continuityActions: 15,
  evidence: 15,
});

const OPEN_TASK_STATUSES = new Set(["todo", "in_progress", "blocked"]);

function clean(value, max = 20_000) {
  return String(value ?? "").trim().slice(0, max);
}

function optionalText(value, max = 20_000) {
  const text = clean(value, max);
  return text || null;
}

function uniqueStrings(values, max = 500) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => clean(value, 4_000)).filter(Boolean))].slice(0, max);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function hash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeScalar(value) {
  return normalizeSearchText(clean(value)).replace(/\s+/g, " ");
}

function scalarSimilarity(expected, actual) {
  const left = normalizeScalar(expected);
  const right = normalizeScalar(actual);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const leftTokens = new Set(tokenizeText(left));
  const rightTokens = new Set(tokenizeText(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

function listSimilarity(expectedValues, actualValues) {
  const expected = uniqueStrings(expectedValues);
  const actual = uniqueStrings(actualValues);
  if (!expected.length && !actual.length) return { score: 1, matched: 0, expected: 0, actual: 0, extras: [] };
  if (!expected.length) return { score: 0, matched: 0, expected: 0, actual: actual.length, extras: actual };
  if (!actual.length) return { score: 0, matched: 0, expected: expected.length, actual: 0, extras: [] };
  const unused = new Set(actual.map((_, index) => index));
  let matchedWeight = 0;
  for (const expectedItem of expected) {
    let bestIndex = -1;
    let bestScore = 0;
    for (const index of unused) {
      const score = scalarSimilarity(expectedItem, actual[index]);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    }
    if (bestIndex >= 0 && bestScore >= 0.55) {
      unused.delete(bestIndex);
      matchedWeight += bestScore;
    }
  }
  const precision = matchedWeight / actual.length;
  const recall = matchedWeight / expected.length;
  const score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { score, matched: matchedWeight, expected: expected.length, actual: actual.length, extras: [...unused].map((index) => actual[index]) };
}

function normalizeRecords(values, fields) {
  return (Array.isArray(values) ? values : []).map((value) => {
    const row = {};
    for (const field of fields) row[field] = field === "progressPercent" ? (Number.isFinite(Number(value?.[field])) ? Number(value[field]) : null) : optionalText(value?.[field], field === "title" ? 500 : 20_000);
    return row;
  }).filter((row) => row.id);
}

function scoreRecords(expectedRows, actualRows, maxScore, type) {
  const expected = new Map(expectedRows.map((row) => [row.id, row]));
  const actual = new Map(actualRows.map((row) => [row.id, row]));
  const expectedIds = [...expected.keys()];
  const actualIds = [...actual.keys()];
  const matchedIds = expectedIds.filter((id) => actual.has(id));
  const extras = actualIds.filter((id) => !expected.has(id));
  const missing = expectedIds.filter((id) => !actual.has(id));
  const coverage = expectedIds.length ? matchedIds.length / expectedIds.length : (actualIds.length ? 0 : 1);
  let correctness = expectedIds.length ? 0 : (actualIds.length ? 0 : 1);
  if (matchedIds.length) {
    correctness = matchedIds.reduce((sum, id) => {
      const left = expected.get(id);
      const right = actual.get(id);
      const title = scalarSimilarity(left.title, right.title);
      const status = normalizeScalar(left.status) === normalizeScalar(right.status) ? 1 : 0;
      if (type !== "task") return sum + (title + status) / 2;
      const priority = normalizeScalar(left.priority) === normalizeScalar(right.priority) ? 1 : 0;
      return sum + (title + status + priority) / 3;
    }, 0) / expectedIds.length;
  }
  const score = maxScore * (coverage * 0.65 + correctness * 0.35);
  return { score, maxScore, coverage, correctness, matchedIds, missingIds: missing, unsupportedIds: extras };
}

function projectEvidence(repository, projectId, preferred = []) {
  const selected = [];
  for (const uri of uniqueStrings(preferred)) if (repository.hasProvenanceUri(uri) && !selected.includes(uri)) selected.push(uri);
  if (selected.length < 5) {
    const rows = repository.searchMessages({ query: "", projectId, activePathOnly: true, limit: 50 });
    for (const row of rows) {
      if (!selected.includes(row.provenance.uri)) selected.push(row.provenance.uri);
      if (selected.length >= 5) break;
    }
  }
  return selected.slice(0, 5);
}

function responseTemplate() {
  return {
    format: "kv-archive-continuity-response",
    version: 1,
    project: { id: null, title: null },
    status: { summary: null, phase: null, health: null, progressPercent: null },
    decisions: [],
    tasks: [],
    blockers: [],
    nextActions: [],
    evidenceUris: [],
    uncertainties: [],
  };
}

export function createContinuityBenchmark(repository, options = {}) {
  const project = clean(options.project || options.projectId || options.projectTitle, 500);
  if (!project) throw new Error("project is required");
  const snapshot = repository.projectSnapshot(project, { conversationLimit: 100 });
  const state = snapshot.approvedState || null;
  const activeDecisions = (state?.decisions || []).filter((row) => (row.status || "active") === "active").map((row) => ({
    id: clean(row.id, 200), title: clean(row.title, 500), status: clean(row.status || "active", 100),
  })).filter((row) => row.id).sort((a, b) => a.id.localeCompare(b.id));
  const openTasks = (state?.tasks || []).filter((row) => OPEN_TASK_STATUSES.has(row.status || "todo")).map((row) => ({
    id: clean(row.id, 200), title: clean(row.title, 500), status: clean(row.status || "todo", 100), priority: clean(row.priority || "medium", 100),
  })).filter((row) => row.id).sort((a, b) => a.id.localeCompare(b.id));
  const preferredEvidence = [
    ...(state?.decisions || []).flatMap((row) => row.evidenceUris || []),
    ...(state?.tasks || []).flatMap((row) => row.evidenceUris || []),
  ];
  const expected = {
    project: { id: snapshot.project.id, title: snapshot.project.title },
    status: {
      summary: optionalText(state?.status?.summary),
      phase: optionalText(state?.status?.phase, 500),
      health: optionalText(state?.status?.health, 100),
      progressPercent: Number.isFinite(Number(state?.status?.progressPercent)) ? Number(state.status.progressPercent) : null,
    },
    decisions: activeDecisions,
    tasks: openTasks,
    blockers: uniqueStrings(state?.status?.blockers, 100),
    nextActions: uniqueStrings(state?.status?.nextActions, 100),
    evidenceUris: projectEvidence(repository, snapshot.project.id, preferredEvidence),
  };
  const identity = {
    bundleId: repository.manifest.bundleId,
    projectId: snapshot.project.id,
    stateVersion: state?.stateVersion || 0,
    stateHash: state?.stateHash || null,
    expected,
    rubric: CONTINUITY_RUBRIC,
  };
  const benchmarkId = `kvb-${hash(identity).slice(0, 24)}`;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const template = responseTemplate();
  const challenge = {
    format: "kv-archive-continuity-challenge",
    version: CONTINUITY_BENCHMARK_VERSION,
    benchmarkId,
    bundleId: repository.manifest.bundleId,
    generatedAt,
    project: { id: snapshot.project.id, title: snapshot.project.title },
    stateVersion: state?.stateVersion || 0,
    stateHash: state?.stateHash || null,
    goal: "Verify that a receiving Agent can correctly identify the current project state and cite local evidence without inventing facts.",
    instructions: [
      "Use only the supplied KV Archive Agent Bundle and its tools.",
      "Return one JSON object matching responseTemplate.",
      "Do not guess. Use null or [] for unavailable facts and explain gaps in uncertainties.",
      "Cite ContextVault evidence URIs that directly support the answer.",
    ],
    rubric: CONTINUITY_RUBRIC,
    responseTemplate: template,
  };
  const answerKey = {
    format: "kv-archive-continuity-answer-key",
    version: CONTINUITY_BENCHMARK_VERSION,
    benchmarkId,
    bundleId: repository.manifest.bundleId,
    generatedAt,
    project: { id: snapshot.project.id, title: snapshot.project.title },
    stateVersion: state?.stateVersion || 0,
    stateHash: state?.stateHash || null,
    expected,
    rubric: CONTINUITY_RUBRIC,
  };
  const prompt = [
    "# KV Archive Continuity Benchmark",
    "",
    `Project: ${snapshot.project.title} (${snapshot.project.id})`,
    `Benchmark: ${benchmarkId}`,
    "",
    ...challenge.instructions.map((line) => `- ${line}`),
    "",
    "Return JSON only using this template:",
    "",
    "```json",
    JSON.stringify(template, null, 2),
    "```",
    "",
  ].join("\n");
  return { challenge, answerKey, responseTemplate: template, prompt };
}

function normalizeResponse(value = {}) {
  return {
    project: { id: optionalText(value.project?.id, 500), title: optionalText(value.project?.title, 500) },
    status: {
      summary: optionalText(value.status?.summary),
      phase: optionalText(value.status?.phase, 500),
      health: optionalText(value.status?.health, 100),
      progressPercent: Number.isFinite(Number(value.status?.progressPercent)) ? Number(value.status.progressPercent) : null,
    },
    decisions: normalizeRecords(value.decisions, ["id", "title", "status"]),
    tasks: normalizeRecords(value.tasks, ["id", "title", "status", "priority"]),
    blockers: uniqueStrings(value.blockers, 100),
    nextActions: uniqueStrings(value.nextActions, 100),
    evidenceUris: uniqueStrings(value.evidenceUris, 500),
    uncertainties: uniqueStrings(value.uncertainties, 100),
  };
}

function statusFieldScore(expected, actual) {
  const fields = [
    ["summary", 5, "text"],
    ["phase", 5, "text"],
    ["health", 5, "exact"],
    ["progressPercent", 5, "number"],
  ];
  const details = [];
  let score = 0;
  for (const [field, max, kind] of fields) {
    const left = expected[field];
    const right = actual[field];
    let ratio;
    if (left === null || left === "") ratio = right === null || right === "" ? 1 : 0;
    else if (kind === "number") ratio = Number(left) === Number(right) ? 1 : 0;
    else if (kind === "exact") ratio = normalizeScalar(left) === normalizeScalar(right) ? 1 : 0;
    else ratio = scalarSimilarity(left, right);
    score += max * ratio;
    details.push({ field, score: Math.round(max * ratio * 100) / 100, maxScore: max, expectedPresent: left !== null && left !== "", actualPresent: right !== null && right !== "" });
  }
  return { score, maxScore: 20, details };
}

export function evaluateContinuityResponse(repository, answerKey, responseValue) {
  if (answerKey?.format !== "kv-archive-continuity-answer-key" || Number(answerKey?.version) !== CONTINUITY_BENCHMARK_VERSION) throw new Error("Invalid continuity benchmark answer key");
  if (answerKey.bundleId !== repository.manifest.bundleId) throw new Error("Benchmark answer key belongs to a different Agent Bundle");
  const expected = answerKey.expected || {};
  const response = normalizeResponse(responseValue);
  const dimensions = [];
  const issues = [];
  const criticalIssues = [];

  const idCorrect = normalizeScalar(response.project.id) === normalizeScalar(expected.project?.id);
  const titleCorrect = normalizeScalar(response.project.title) === normalizeScalar(expected.project?.title);
  const identityScore = (idCorrect ? 5 : 0) + (titleCorrect ? 5 : 0);
  dimensions.push({ id: "projectIdentity", label: "Project identity", score: identityScore, maxScore: 10, details: { idCorrect, titleCorrect } });
  if (!idCorrect) criticalIssues.push("Project ID is missing or incorrect");

  const status = statusFieldScore(expected.status || {}, response.status);
  dimensions.push({ id: "currentStatus", label: "Current status", ...status });

  const decisions = scoreRecords(expected.decisions || [], response.decisions, 20, "decision");
  dimensions.push({ id: "decisions", label: "Active decisions", ...decisions });
  if (decisions.unsupportedIds.length) criticalIssues.push(`Unsupported decision IDs: ${decisions.unsupportedIds.join(", ")}`);
  if (decisions.missingIds.length) issues.push(`Missing decision IDs: ${decisions.missingIds.join(", ")}`);

  const tasks = scoreRecords(expected.tasks || [], response.tasks, 20, "task");
  dimensions.push({ id: "tasks", label: "Open tasks", ...tasks });
  if (tasks.unsupportedIds.length) criticalIssues.push(`Unsupported task IDs: ${tasks.unsupportedIds.join(", ")}`);
  if (tasks.missingIds.length) issues.push(`Missing task IDs: ${tasks.missingIds.join(", ")}`);

  const blockers = listSimilarity(expected.blockers || [], response.blockers);
  const nextActions = listSimilarity(expected.nextActions || [], response.nextActions);
  const continuityScore = 7.5 * blockers.score + 7.5 * nextActions.score;
  dimensions.push({ id: "continuityActions", label: "Blockers and next actions", score: continuityScore, maxScore: 15, details: { blockers, nextActions } });
  if (blockers.extras.length) issues.push(`Unsupported blockers: ${blockers.extras.join(" | ")}`);
  if (nextActions.extras.length) issues.push(`Unsupported next actions: ${nextActions.extras.join(" | ")}`);

  const expectedEvidence = uniqueStrings(expected.evidenceUris, 500);
  const actualEvidence = response.evidenceUris;
  const invalidEvidence = actualEvidence.filter((uri) => !repository.hasProvenanceUri(uri));
  const validEvidence = actualEvidence.filter((uri) => repository.hasProvenanceUri(uri));
  const coveredEvidence = expectedEvidence.filter((uri) => validEvidence.includes(uri));
  const coverage = expectedEvidence.length ? coveredEvidence.length / expectedEvidence.length : (validEvidence.length || !actualEvidence.length ? 1 : 0);
  const validity = actualEvidence.length ? validEvidence.length / actualEvidence.length : (expectedEvidence.length ? 0 : 1);
  const evidenceScore = 10 * coverage + 5 * validity;
  dimensions.push({ id: "evidence", label: "Evidence citations", score: evidenceScore, maxScore: 15, details: { expected: expectedEvidence.length, cited: actualEvidence.length, covered: coveredEvidence.length, invalidEvidence } });
  if (invalidEvidence.length) criticalIssues.push(`Invalid evidence URIs: ${invalidEvidence.join(", ")}`);
  if (expectedEvidence.length && !actualEvidence.length) issues.push("No evidence URI was cited");

  const score = Math.min(100, Math.max(0, Math.round(dimensions.reduce((sum, row) => sum + row.score, 0) * 100) / 100));
  const verdict = criticalIssues.length ? "FAIL" : score >= 85 ? "PASS" : score >= 65 ? "PARTIAL" : "FAIL";
  const report = {
    format: "kv-archive-continuity-report",
    version: CONTINUITY_BENCHMARK_VERSION,
    benchmarkId: answerKey.benchmarkId,
    bundleId: repository.manifest.bundleId,
    project: answerKey.project,
    score,
    maxScore: 100,
    verdict,
    verified: verdict === "PASS",
    dimensions: dimensions.map((row) => ({ ...row, score: Math.round(row.score * 100) / 100 })),
    criticalIssues,
    issues,
    uncertainties: response.uncertainties,
  };
  const markdown = [
    "# KV Archive Continuity Benchmark Report",
    "",
    `- Project: ${answerKey.project.title} (${answerKey.project.id})`,
    `- Benchmark: ${answerKey.benchmarkId}`,
    `- Verdict: **${verdict}**`,
    `- Score: **${score}/100**`,
    `- Verified handoff: **${report.verified ? "yes" : "no"}**`,
    "",
    "## Dimensions",
    "",
    ...report.dimensions.map((row) => `- ${row.label}: ${row.score}/${row.maxScore}`),
    "",
    "## Critical issues",
    "",
    ...(criticalIssues.length ? criticalIssues.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Other issues",
    "",
    ...(issues.length ? issues.map((item) => `- ${item}`) : ["- None"]),
    "",
  ].join("\n");
  return { report, markdown };
}
