import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { AgentRepository, estimateTokens, loadAgentBundleBytes, readStoredZipEntries } from "./agent-core.js";
import { buildScopedAgentBundle, sha256Hex, stableStringify } from "./bundle-builder.js";
import { createContinuityBenchmark, evaluateContinuityResponse } from "./continuity-benchmark.js";
import { memoryGateManifest, renderMemoryGateMarkdown } from "./memory-gate.js";
import { createStoredZip } from "./zip-writer.js";
import { BRIDGE_VERSION } from "./version.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const HANDOFF_VERSION = 1;
const RECEIVER_FORMAT = "kv-archive-verified-handoff";
const KIT_FORMAT = "kv-archive-handoff-verification-kit";
const RECEIVER_REQUIRED = [
  "README.md",
  "START_HERE.md",
  "contract/handoff-contract.json",
  "state/approved-project-state.json",
  "data/agent-bundle.zip",
  "context/CONTEXT_PACK.md",
  "memory/memory-gate-manifest.json",
  "memory/memory-gate-report.json",
  "memory/memory-gate-report.md",
  "benchmark/PROMPT.md",
  "benchmark/benchmark-challenge.json",
  "benchmark/response-template.json",
  "receipts/sender-receipt.json",
];
const KIT_REQUIRED = [
  "README.md",
  "contract/handoff-contract.json",
  "benchmark/benchmark-answer-key.json",
  "receipts/sender-receipt.json",
  "receiver-package-sha256.txt",
];

function parseJson(bytes, label) {
  try { return JSON.parse(decoder.decode(bytes)); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function entryData(value) { return typeof value === "string" ? encoder.encode(value) : value; }

function metadataForEntries(entries) {
  return entries.map((entry) => {
    const data = entryData(entry.data);
    return { name: entry.name, bytes: data.length, sha256: sha256Hex(data) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function manifestEntryMap(manifest) {
  return new Map((manifest?.entries || []).map((entry) => [entry.name, entry]));
}

function validatePackageEntries(entries, manifest, requiredNames, format) {
  const failures = [];
  const warnings = [];
  if (manifest?.format !== format) failures.push({ code: "PACKAGE_FORMAT_INVALID", message: `Expected ${format}` });
  if (Number(manifest?.version) !== HANDOFF_VERSION) failures.push({ code: "PACKAGE_VERSION_UNSUPPORTED", message: `Unsupported package version: ${manifest?.version}` });
  const declaredRows = Array.isArray(manifest?.entries) ? manifest.entries : [];
  const declaredNames = declaredRows.map((entry) => entry?.name);
  if (new Set(declaredNames).size !== declaredNames.length) failures.push({ code: "PACKAGE_MANIFEST_DUPLICATE_ENTRY", message: "Manifest declares duplicate entry names" });
  const declared = manifestEntryMap(manifest);
  for (const name of requiredNames) if (!entries.has(name)) failures.push({ code: "PACKAGE_ENTRY_MISSING", message: `Missing ${name}`, entry: name });
  for (const [name, expected] of declared) {
    const data = entries.get(name);
    if (!data) { failures.push({ code: "PACKAGE_ENTRY_MISSING", message: `Missing declared entry ${name}`, entry: name }); continue; }
    if (Number(expected.bytes) !== data.length) failures.push({ code: "PACKAGE_ENTRY_SIZE_MISMATCH", message: `Size mismatch for ${name}`, entry: name });
    if (expected.sha256 !== sha256Hex(data)) failures.push({ code: "PACKAGE_ENTRY_HASH_MISMATCH", message: `SHA-256 mismatch for ${name}`, entry: name });
  }
  const allowed = new Set(["manifest.json", ...declared.keys()]);
  for (const name of entries.keys()) if (!allowed.has(name)) failures.push({ code: "PACKAGE_UNEXPECTED_ENTRY", message: `Unexpected entry ${name}`, entry: name });
  if (!manifest?.payloadRootHash || manifest.payloadRootHash !== sha256Hex(stableStringify([...(manifest.entries || [])].sort((a, b) => a.name.localeCompare(b.name))))) {
    failures.push({ code: "PACKAGE_ROOT_HASH_MISMATCH", message: "Payload root hash does not match entry metadata" });
  }
  return { failures, warnings };
}

function buildManifest(format, identity, entries) {
  const metadata = metadataForEntries(entries);
  return {
    format,
    version: HANDOFF_VERSION,
    sourceApp: "KV Archive",
    sourceAppVersion: BRIDGE_VERSION,
    ...identity,
    entries: metadata,
    payloadRootHash: sha256Hex(stableStringify(metadata)),
  };
}

function receiverReadme(contract) {
  return [
    "# KV Archive Verified Handoff",
    "",
    `Handoff: ${contract.handoffId}`,
    `Project: ${contract.project.title} (${contract.project.id})`,
    "",
    "This is the receiver package. It contains a project-scoped, read-only Agent Bundle, a governed Context Pack, a Memory Gate receipt and a public Continuity Benchmark challenge.",
    "",
    "It does not contain the private benchmark answer key. Run `handoff-receive` before using the package.",
    "",
  ].join("\n");
}

function receiverStart(contract) {
  return [
    "# Receiver start",
    "",
    "1. Run the Agent Bridge `handoff-receive` command. Do not manually trust or extract the package before preflight.",
    "2. Start a fresh receiving-Agent context with the extracted project-scoped Agent Bundle.",
    "3. Give the Agent `CONTEXT_PACK.md` and `PROMPT.md`.",
    "4. Save the final JSON as `handoff-response.json` without viewing any private answer key.",
    "5. Return the response and the generated receiver preflight receipt to the sender for verification.",
    "",
    `Goal: ${contract.goal}`,
    "",
    "Approved Project State is read-only. Any suggested change must be emitted as a review-required proposal; it is not approved merely because an Agent produced it.",
    "",
  ].join("\n");
}

function verificationKitReadme(contract) {
  return [
    "# KV Archive Handoff Verification Kit",
    "",
    `Handoff: ${contract.handoffId}`,
    "",
    "PRIVATE: keep this package away from the receiving Agent. It contains the Continuity Benchmark answer key and the expected receiver-package hash.",
    "",
    "Use `handoff-verify` only after the receiver returns its preflight receipt and final response JSON.",
    "",
  ].join("\n");
}

function failure(code, message, details = {}) { return { code, message, ...details }; }

export function createVerifiedHandoff(repository, options = {}) {
  const project = options.project || options.projectId || options.projectTitle;
  if (!project) throw new Error("project is required");
  const query = String(options.query || "Continue the current project accurately").trim();
  const generatedAt = options.generatedAt || new Date().toISOString();
  const contextBudget = Number(options.contextBudget || options.budgetTokens || 8192);
  if (![2048, 8192, 32768].includes(contextBudget)) throw new Error("contextBudget must be 2048, 8192, or 32768");
  const gatePolicy = options.gatePolicy || options.policy || "balanced";
  if (!["safe", "balanced", "broad"].includes(gatePolicy)) throw new Error("gatePolicy must be safe, balanced, or broad");
  const gateTarget = options.gateTarget || "internal";
  if (!["internal", "external"].includes(gateTarget)) throw new Error("gateTarget must be internal or external");
  const gateBudget = Math.max(256, Math.floor(Number(options.gateBudget || options.memoryGateBudgetTokens || Math.min(2048, Math.floor(contextBudget * 0.35)))));
  const scoped = buildScopedAgentBundle(repository, project, { generatedAt });
  const scopedRepository = new AgentRepository(loadAgentBundleBytes(scoped.bytes));
  const state = scopedRepository.projectState(scoped.records.project.id);
  if (!state) throw new Error("Approved Project State is required for Verified Handoff");
  const gate = scopedRepository.runMemoryGate({ project: scoped.records.project.id, policy: gatePolicy, target: gateTarget, tokenBudget: gateBudget, generatedAt });
  const allowReview = Boolean(options.allowReview);
  const allowBudgetOverrun = Boolean(options.allowBudgetOverrun);
  if (gate.counts.REVIEW > 0 && !allowReview) {
    const error = new Error(`Memory Gate requires review for ${gate.counts.REVIEW} candidate(s); resolve them or pass --allow-review explicitly`);
    error.code = "HANDOFF_REVIEW_REQUIRED";
    throw error;
  }
  if (gate.budgetOverrun > 0 && !allowBudgetOverrun) {
    const error = new Error(`Locked memory exceeds the Gate budget by ${gate.budgetOverrun} token(s); increase the budget or pass --allow-budget-overrun explicitly`);
    error.code = "HANDOFF_GATE_BUDGET_OVERRUN";
    throw error;
  }
  const pack = scopedRepository.buildContextPack({
    query,
    projectId: scoped.records.project.id,
    budgetTokens: contextBudget,
    memoryGatePolicy: gatePolicy,
    memoryGateTarget: gateTarget,
    memoryGateBudgetTokens: gateBudget,
    generatedAt,
  });
  const benchmark = createContinuityBenchmark(scopedRepository, { project: scoped.records.project.id, generatedAt });
  const identity = {
    sourceBundleId: repository.manifest.bundleId,
    sourceBundleSha256: options.sourceBundleSha256 || null,
    scopedBundleId: scoped.manifest.bundleId,
    scopedBundleSha256: scoped.sha256,
    project: scoped.records.project,
    stateVersion: Number(state.stateVersion || 0),
    stateHash: state.stateHash || null,
    query,
    contextBudget,
    gatePolicy,
    gateTarget,
    gateBudget,
    benchmarkId: benchmark.challenge.benchmarkId,
    allowReview,
    allowBudgetOverrun,
  };
  const handoffId = `kvh-${sha256Hex(stableStringify(identity)).slice(0, 24)}`;
  const contract = {
    format: "kv-archive-handoff-contract",
    version: HANDOFF_VERSION,
    handoffId,
    generatedAt,
    project: scoped.records.project,
    sourceBundle: { id: repository.manifest.bundleId, sha256: options.sourceBundleSha256 || null },
    stateVersion: Number(state.stateVersion || 0),
    stateHash: state.stateHash || null,
    goal: query,
    contextBudget,
    memoryGate: { policy: gatePolicy, target: gateTarget, tokenBudget: gateBudget, counts: gate.counts, usedTokens: gate.usedTokens, budgetOverrun: gate.budgetOverrun },
    benchmarkId: benchmark.challenge.benchmarkId,
    allowedActions: ["read_project_evidence", "read_approved_state", "read_unified_content", "create_review_required_proposals", "return_benchmark_response"],
    prohibitedActions: ["mutate_approved_project_state", "treat_proposals_as_approved", "access_other_projects", "view_private_answer_key", "invent_evidence_uris"],
    completionRequirements: ["receiver_preflight_pass", "fresh_receiving_agent_context", "valid_response_json", "continuity_benchmark_pass", "no_critical_identity_or_evidence_errors"],
    exceptions: { memoryGateReviewAllowed: allowReview, memoryGateBudgetOverrunAllowed: allowBudgetOverrun },
  };
  const memoryJson = `${JSON.stringify(gate, null, 2)}\n`;
  const memoryManifestJson = `${JSON.stringify(memoryGateManifest(gate), null, 2)}\n`;
  const senderReceipt = {
    format: "kv-archive-handoff-sender-receipt",
    version: HANDOFF_VERSION,
    receiptId: `sender-${handoffId}`,
    handoffId,
    generatedAt,
    sourceBundleId: repository.manifest.bundleId,
    sourceBundleSha256: options.sourceBundleSha256 || null,
    scopedBundleId: scoped.manifest.bundleId,
    scopedBundleSha256: scoped.sha256,
    project: scoped.records.project,
    stateVersion: contract.stateVersion,
    stateHash: contract.stateHash,
    contextPackSha256: sha256Hex(pack.markdown),
    memoryGateReportSha256: sha256Hex(memoryJson),
    benchmarkId: benchmark.challenge.benchmarkId,
    status: gate.counts.REVIEW || gate.budgetOverrun ? "READY_WITH_EXPLICIT_EXCEPTIONS" : "READY",
    warnings: [
      ...(gate.counts.REVIEW ? ["MEMORY_GATE_REVIEW_ALLOWED"] : []),
      ...(gate.budgetOverrun ? ["MEMORY_GATE_BUDGET_OVERRUN_ALLOWED"] : []),
    ],
    approvedStateMutated: false,
  };
  const receiverEntries = [
    { name: "README.md", data: receiverReadme(contract) },
    { name: "START_HERE.md", data: receiverStart(contract) },
    { name: "contract/handoff-contract.json", data: `${JSON.stringify(contract, null, 2)}\n` },
    { name: "state/approved-project-state.json", data: `${JSON.stringify(state, null, 2)}\n` },
    { name: "data/agent-bundle.zip", data: scoped.bytes },
    { name: "context/CONTEXT_PACK.md", data: pack.markdown },
    { name: "memory/memory-gate-manifest.json", data: memoryManifestJson },
    { name: "memory/memory-gate-report.json", data: memoryJson },
    { name: "memory/memory-gate-report.md", data: renderMemoryGateMarkdown(gate) },
    { name: "benchmark/PROMPT.md", data: benchmark.prompt },
    { name: "benchmark/benchmark-challenge.json", data: `${JSON.stringify(benchmark.challenge, null, 2)}\n` },
    { name: "benchmark/response-template.json", data: `${JSON.stringify(benchmark.responseTemplate, null, 2)}\n` },
    { name: "receipts/sender-receipt.json", data: `${JSON.stringify(senderReceipt, null, 2)}\n` },
  ];
  const receiverManifest = buildManifest(RECEIVER_FORMAT, { handoffId, generatedAt, project: contract.project, stateVersion: contract.stateVersion, stateHash: contract.stateHash, benchmarkId: contract.benchmarkId, scopedBundleId: scoped.manifest.bundleId }, receiverEntries);
  const receiverBytes = createStoredZip([{ name: "manifest.json", data: `${JSON.stringify(receiverManifest, null, 2)}\n` }, ...receiverEntries], new Date(generatedAt));
  const receiverSha256 = sha256Hex(receiverBytes);
  const kitEntries = [
    { name: "README.md", data: verificationKitReadme(contract) },
    { name: "contract/handoff-contract.json", data: `${JSON.stringify(contract, null, 2)}\n` },
    { name: "benchmark/benchmark-answer-key.json", data: `${JSON.stringify(benchmark.answerKey, null, 2)}\n` },
    { name: "receipts/sender-receipt.json", data: `${JSON.stringify(senderReceipt, null, 2)}\n` },
    { name: "receiver-package-sha256.txt", data: `${receiverSha256}  KV-Archive-Verified-Handoff-${handoffId}.zip\n` },
  ];
  const kitManifest = buildManifest(KIT_FORMAT, { handoffId, generatedAt, project: contract.project, benchmarkId: contract.benchmarkId, expectedReceiverPackageSha256: receiverSha256, expectedReceiverPayloadRootHash: receiverManifest.payloadRootHash }, kitEntries);
  const kitBytes = createStoredZip([{ name: "manifest.json", data: `${JSON.stringify(kitManifest, null, 2)}\n` }, ...kitEntries], new Date(generatedAt));
  return {
    handoffId,
    contract,
    senderReceipt,
    receiver: { manifest: receiverManifest, bytes: receiverBytes, sha256: receiverSha256, filename: `KV-Archive-Verified-Handoff-${handoffId}.zip` },
    verificationKit: { manifest: kitManifest, bytes: kitBytes, sha256: sha256Hex(kitBytes), filename: `KV-Archive-Handoff-Verification-Kit-${handoffId}.zip` },
    scopedBundle: scoped,
    memoryGate: gate,
    contextPack: pack,
    benchmark,
  };
}

export function preflightVerifiedHandoffBytes(bytes) {
  const packageBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (packageBytes.length > 536_870_912) return { status: "BLOCKED", failures: [failure("PACKAGE_TOO_LARGE", "Receiver package exceeds the 512 MB preflight limit")], warnings: [], packageSha256: sha256Hex(packageBytes) };
  let entries;
  try { entries = readStoredZipEntries(packageBytes); }
  catch (error) {
    return { status: "BLOCKED", failures: [failure("PACKAGE_ZIP_INVALID", error instanceof Error ? error.message : String(error))], warnings: [], packageSha256: sha256Hex(packageBytes) };
  }
  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) return { status: "BLOCKED", failures: [failure("PACKAGE_MANIFEST_MISSING", "manifest.json is missing")], warnings: [], packageSha256: sha256Hex(packageBytes) };
  let manifest;
  try { manifest = parseJson(manifestBytes, "manifest.json"); }
  catch (error) { return { status: "BLOCKED", failures: [failure("PACKAGE_MANIFEST_INVALID", error.message)], warnings: [], packageSha256: sha256Hex(packageBytes) }; }
  const validation = validatePackageEntries(entries, manifest, RECEIVER_REQUIRED, RECEIVER_FORMAT);
  const failures = [...validation.failures];
  const warnings = [...validation.warnings];
  if ([...entries.keys()].some((name) => /answer-key/i.test(name))) failures.push(failure("PRIVATE_ANSWER_KEY_EXPOSED", "Receiver package contains a private answer key"));
  let contract = null;
  let state = null;
  let gate = null;
  let challenge = null;
  let senderReceipt = null;
  let scopedRepository = null;
  let scopedBundle = null;
  try { contract = parseJson(entries.get("contract/handoff-contract.json"), "handoff-contract.json"); } catch (error) { failures.push(failure("CONTRACT_INVALID", error.message)); }
  if (contract && (contract.format !== "kv-archive-handoff-contract" || Number(contract.version) !== HANDOFF_VERSION)) failures.push(failure("CONTRACT_FORMAT_INVALID", "Handoff contract format or version is invalid"));
  try { state = parseJson(entries.get("state/approved-project-state.json"), "approved-project-state.json"); } catch (error) { failures.push(failure("STATE_INVALID", error.message)); }
  try { gate = parseJson(entries.get("memory/memory-gate-report.json"), "memory-gate-report.json"); } catch (error) { failures.push(failure("MEMORY_GATE_REPORT_INVALID", error.message)); }
  try { challenge = parseJson(entries.get("benchmark/benchmark-challenge.json"), "benchmark-challenge.json"); } catch (error) { failures.push(failure("BENCHMARK_CHALLENGE_INVALID", error.message)); }
  try { senderReceipt = parseJson(entries.get("receipts/sender-receipt.json"), "sender-receipt.json"); } catch (error) { failures.push(failure("SENDER_RECEIPT_INVALID", error.message)); }
  const embedded = entries.get("data/agent-bundle.zip");
  if (embedded) {
    try {
      scopedBundle = loadAgentBundleBytes(embedded);
      scopedRepository = new AgentRepository(scopedBundle);
    } catch (error) { failures.push(failure("EMBEDDED_BUNDLE_INVALID", error instanceof Error ? error.message : String(error))); }
  }
  if (contract && manifest.handoffId !== contract.handoffId) failures.push(failure("HANDOFF_ID_MISMATCH", "Manifest and contract handoff IDs differ"));
  if (senderReceipt && contract && senderReceipt.handoffId !== contract.handoffId) failures.push(failure("SENDER_RECEIPT_HANDOFF_MISMATCH", "Sender receipt belongs to a different handoff"));
  if (senderReceipt && contract?.sourceBundle) {
    if (senderReceipt.sourceBundleId !== contract.sourceBundle.id) failures.push(failure("SOURCE_BUNDLE_ID_MISMATCH", "Sender receipt source Bundle ID does not match contract"));
    if ((senderReceipt.sourceBundleSha256 || null) !== (contract.sourceBundle.sha256 || null)) failures.push(failure("SOURCE_BUNDLE_HASH_MISMATCH", "Sender receipt source Bundle hash does not match contract"));
  }
  if (senderReceipt) {
    if (senderReceipt.format !== "kv-archive-handoff-sender-receipt" || Number(senderReceipt.version) !== HANDOFF_VERSION) failures.push(failure("SENDER_RECEIPT_FORMAT_INVALID", "Sender receipt format is invalid"));
    const embeddedBytes = entries.get("data/agent-bundle.zip");
    if (embeddedBytes && senderReceipt.scopedBundleSha256 !== sha256Hex(embeddedBytes)) failures.push(failure("SENDER_RECEIPT_BUNDLE_HASH_MISMATCH", "Sender receipt bundle hash does not match embedded bundle"));
    const contextBytes = entries.get("context/CONTEXT_PACK.md");
    if (contextBytes && senderReceipt.contextPackSha256 !== sha256Hex(contextBytes)) failures.push(failure("SENDER_RECEIPT_CONTEXT_HASH_MISMATCH", "Sender receipt Context Pack hash does not match"));
    const gateBytes = entries.get("memory/memory-gate-report.json");
    if (gateBytes && senderReceipt.memoryGateReportSha256 !== sha256Hex(gateBytes)) failures.push(failure("SENDER_RECEIPT_GATE_HASH_MISMATCH", "Sender receipt Memory Gate hash does not match"));
    if (contract && senderReceipt.benchmarkId !== contract.benchmarkId) failures.push(failure("SENDER_RECEIPT_BENCHMARK_MISMATCH", "Sender receipt benchmark does not match contract"));
  }
  if (state && contract) {
    if (state.projectId !== contract.project?.id) failures.push(failure("PROJECT_ID_MISMATCH", "Approved state project does not match handoff contract"));
    if (Number(state.stateVersion || 0) !== Number(contract.stateVersion || 0)) failures.push(failure("STATE_VERSION_MISMATCH", "Approved state version does not match handoff contract"));
    if ((state.stateHash || null) !== (contract.stateHash || null)) failures.push(failure("STATE_HASH_MISMATCH", "Approved state hash does not match handoff contract"));
  }
  if (gate && contract) {
    if (gate.projectId !== contract.project?.id) failures.push(failure("MEMORY_GATE_PROJECT_MISMATCH", "Memory Gate project does not match handoff contract"));
    if (gate.policy !== contract.memoryGate?.policy || gate.target !== contract.memoryGate?.target) failures.push(failure("MEMORY_GATE_POLICY_MISMATCH", "Memory Gate policy or target does not match contract"));
    if (gate.counts?.REVIEW > 0) {
      if (contract.exceptions?.memoryGateReviewAllowed) warnings.push(failure("MEMORY_GATE_REVIEW_ALLOWED", `${gate.counts.REVIEW} memory candidate(s) require review`));
      else failures.push(failure("MEMORY_GATE_REVIEW_REQUIRED", `${gate.counts.REVIEW} memory candidate(s) require review`));
    }
    if (gate.budgetOverrun > 0) {
      if (contract.exceptions?.memoryGateBudgetOverrunAllowed) warnings.push(failure("MEMORY_GATE_BUDGET_OVERRUN_ALLOWED", `Gate budget overrun: ${gate.budgetOverrun}`));
      else failures.push(failure("MEMORY_GATE_BUDGET_OVERRUN", `Gate budget overrun: ${gate.budgetOverrun}`));
    }
  }
  if (challenge && contract) {
    if (challenge.benchmarkId !== contract.benchmarkId) failures.push(failure("BENCHMARK_ID_MISMATCH", "Benchmark challenge does not match contract"));
    if (challenge.project?.id !== contract.project?.id) failures.push(failure("BENCHMARK_PROJECT_MISMATCH", "Benchmark project does not match contract"));
    if (Number(challenge.stateVersion || 0) !== Number(contract.stateVersion || 0)) failures.push(failure("BENCHMARK_STATE_VERSION_MISMATCH", "Benchmark state version does not match contract"));
    if ((challenge.stateHash || null) !== (contract.stateHash || null)) failures.push(failure("BENCHMARK_STATE_HASH_MISMATCH", "Benchmark state hash does not match contract"));
  }
  if (scopedRepository && contract) {
    if (scopedRepository.manifest.bundleId !== manifest.scopedBundleId) failures.push(failure("SCOPED_BUNDLE_ID_MISMATCH", "Embedded bundle ID does not match manifest"));
    const projects = scopedRepository.listProjects();
    const foreign = projects.filter((project) => project.id !== contract.project?.id);
    const recordProjectIds = [
      ...scopedBundle.conversations.map((row) => row.projectId),
      ...scopedBundle.contentObjects.map((row) => row.projectId),
      ...scopedBundle.states.map((row) => row.projectId),
    ];
    const invalidScopeIds = [...new Set(recordProjectIds.filter((id) => id !== contract.project?.id))];
    if (foreign.length || invalidScopeIds.length) failures.push(failure("PROJECT_SCOPE_VIOLATION", "Embedded bundle contains missing or foreign Project scope", { projectIds: [...new Set([...foreign.map((row) => row.id), ...invalidScopeIds.map((id) => id || "(missing)")])] }));
    const embeddedState = scopedRepository.projectState(contract.project?.id);
    if (!embeddedState) failures.push(failure("APPROVED_STATE_MISSING", "Embedded bundle does not contain approved Project State"));
    else if (Number(embeddedState.stateVersion || 0) !== Number(contract.stateVersion || 0) || (embeddedState.stateHash || null) !== (contract.stateHash || null)) failures.push(failure("EMBEDDED_STATE_MISMATCH", "Embedded bundle state does not match contract"));
    if (challenge?.bundleId !== scopedRepository.manifest.bundleId) failures.push(failure("BENCHMARK_BUNDLE_MISMATCH", "Benchmark challenge belongs to a different embedded bundle"));
  }
  const contextBytes = entries.get("context/CONTEXT_PACK.md");
  if (contextBytes && contract) {
    const context = decoder.decode(contextBytes);
    const tokens = estimateTokens(context);
    if (tokens > Number(contract.contextBudget || 0)) failures.push(failure("CONTEXT_PACK_BUDGET_EXCEEDED", `Context Pack estimate ${tokens} exceeds contract budget ${contract.contextBudget}`));
    if (manifest.scopedBundleId && !context.includes(`Bundle: ${manifest.scopedBundleId}`)) failures.push(failure("CONTEXT_PACK_BUNDLE_MISMATCH", "Context Pack does not identify the embedded bundle"));
  }
  return {
    format: "kv-archive-handoff-preflight-report",
    version: HANDOFF_VERSION,
    handoffId: manifest.handoffId || contract?.handoffId || null,
    packageSha256: sha256Hex(packageBytes),
    payloadRootHash: manifest.payloadRootHash || null,
    status: failures.length ? "BLOCKED" : "PASS",
    failures,
    warnings,
    manifest,
    contract,
    senderReceipt,
    scopedBundle,
    stats: scopedRepository ? scopedRepository.stats() : null,
    entries,
  };
}

export async function receiveVerifiedHandoff(handoffPath, outputDirectory, options = {}) {
  const packagePath = resolve(handoffPath);
  const packageBytes = new Uint8Array(await readFile(packagePath));
  const preflight = preflightVerifiedHandoffBytes(packageBytes);
  if (preflight.status !== "PASS") {
    const error = new Error(`Verified Handoff preflight blocked: ${preflight.failures.map((item) => item.code).join(", ")}`);
    error.code = "HANDOFF_PREFLIGHT_BLOCKED";
    error.report = preflight;
    throw error;
  }
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const entries = preflight.entries;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const receiver = String(options.receiver || "receiving-agent").trim() || "receiving-agent";
  const receiptIdentity = { handoffId: preflight.handoffId, packageSha256: preflight.packageSha256, receiver, generatedAt };
  const receiptId = `receiver-${sha256Hex(stableStringify(receiptIdentity)).slice(0, 24)}`;
  const receipt = {
    format: "kv-archive-handoff-receiver-receipt",
    version: HANDOFF_VERSION,
    receiptId,
    handoffId: preflight.handoffId,
    generatedAt,
    receiver,
    status: "PASS",
    packageFile: basename(packagePath),
    packageSha256: preflight.packageSha256,
    payloadRootHash: preflight.payloadRootHash,
    project: preflight.contract.project,
    stateVersion: preflight.contract.stateVersion,
    stateHash: preflight.contract.stateHash,
    scopedBundleId: preflight.manifest.scopedBundleId,
    warnings: preflight.warnings,
    receiptTrust: "self_attested_local_receipt",
    approvedStateMutated: false,
  };
  const files = {
    bundle: join(output, "agent-bundle.zip"),
    contextPack: join(output, "CONTEXT_PACK.md"),
    prompt: join(output, "PROMPT.md"),
    challenge: join(output, "benchmark-challenge.json"),
    response: join(output, "handoff-response.json"),
    contract: join(output, "handoff-contract.json"),
    senderReceipt: join(output, "sender-receipt.json"),
    receiverReceipt: join(output, `receiver-preflight-receipt-${receiptId}.json`),
    instructions: join(output, "RECEIVER_RUN_INSTRUCTIONS.md"),
  };
  for (const path of Object.values(files)) {
    try { await access(path); throw new Error(`Refusing to overwrite ${path}`); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  const writeExclusive = async (path, data) => writeFile(path, data, { flag: "wx" });
  await Promise.all([
    writeExclusive(files.bundle, entries.get("data/agent-bundle.zip")),
    writeExclusive(files.contextPack, entries.get("context/CONTEXT_PACK.md")),
    writeExclusive(files.prompt, entries.get("benchmark/PROMPT.md")),
    writeExclusive(files.challenge, entries.get("benchmark/benchmark-challenge.json")),
    writeExclusive(files.response, entries.get("benchmark/response-template.json")),
    writeExclusive(files.contract, entries.get("contract/handoff-contract.json")),
    writeExclusive(files.senderReceipt, entries.get("receipts/sender-receipt.json")),
    writeExclusive(files.receiverReceipt, `${JSON.stringify(receipt, null, 2)}\n`),
    writeExclusive(files.instructions, receiverStart(preflight.contract)),
  ]);
  return { preflight: { ...preflight, entries: undefined, scopedBundle: undefined }, receipt, output, files };
}

function parseVerificationKitBytes(bytes) {
  const packageBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const entries = readStoredZipEntries(packageBytes);
  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) throw new Error("Verification Kit manifest.json is missing");
  const manifest = parseJson(manifestBytes, "verification kit manifest.json");
  const validation = validatePackageEntries(entries, manifest, KIT_REQUIRED, KIT_FORMAT);
  if (validation.failures.length) {
    const error = new Error(`Verification Kit is invalid: ${validation.failures.map((item) => item.code).join(", ")}`);
    error.failures = validation.failures;
    throw error;
  }
  return { bytes: packageBytes, sha256: sha256Hex(packageBytes), entries, manifest };
}

export async function verifyHandoffResponse(options = {}) {
  const handoffBytes = new Uint8Array(await readFile(resolve(options.handoffPath)));
  const preflight = preflightVerifiedHandoffBytes(handoffBytes);
  const failures = [...preflight.failures];
  const warnings = [...preflight.warnings];
  let kit = null;
  try { kit = parseVerificationKitBytes(new Uint8Array(await readFile(resolve(options.verificationKitPath)))); }
  catch (error) { failures.push(failure("VERIFICATION_KIT_INVALID", error instanceof Error ? error.message : String(error))); }
  let receiverReceipt = null;
  try { receiverReceipt = JSON.parse(await readFile(resolve(options.receiverReceiptPath), "utf8")); }
  catch (error) { failures.push(failure("RECEIVER_RECEIPT_INVALID", error instanceof Error ? error.message : String(error))); }
  let response = null;
  try { response = JSON.parse(await readFile(resolve(options.responsePath), "utf8")); }
  catch (error) { failures.push(failure("RESPONSE_INVALID_JSON", error instanceof Error ? error.message : String(error))); }
  if (kit) {
    if (kit.manifest.handoffId !== preflight.handoffId) failures.push(failure("VERIFICATION_KIT_HANDOFF_MISMATCH", "Verification Kit belongs to a different handoff"));
    if (kit.manifest.expectedReceiverPackageSha256 !== preflight.packageSha256) failures.push(failure("RECEIVER_PACKAGE_HASH_MISMATCH", "Receiver package hash does not match the private kit"));
    if (kit.manifest.expectedReceiverPayloadRootHash !== preflight.payloadRootHash) failures.push(failure("RECEIVER_PAYLOAD_ROOT_MISMATCH", "Receiver payload root does not match the private kit"));
  }
  if (receiverReceipt) {
    if (receiverReceipt.format !== "kv-archive-handoff-receiver-receipt" || Number(receiverReceipt.version) !== HANDOFF_VERSION) failures.push(failure("RECEIVER_RECEIPT_FORMAT_INVALID", "Receiver receipt format is invalid"));
    if (receiverReceipt.status !== "PASS") failures.push(failure("RECEIVER_PREFLIGHT_NOT_PASSED", "Receiver preflight receipt is not PASS"));
    if (receiverReceipt.handoffId !== preflight.handoffId) failures.push(failure("RECEIVER_RECEIPT_HANDOFF_MISMATCH", "Receiver receipt belongs to a different handoff"));
    if (receiverReceipt.packageSha256 !== preflight.packageSha256) failures.push(failure("RECEIVER_RECEIPT_PACKAGE_MISMATCH", "Receiver receipt references a different package"));
    if (receiverReceipt.approvedStateMutated !== false) failures.push(failure("APPROVED_STATE_MUTATION_CLAIM", "Receiver receipt does not affirm read-only approved state"));
    if (receiverReceipt.receiptTrust !== "self_attested_local_receipt") warnings.push(failure("RECEIVER_RECEIPT_TRUST_UNDECLARED", "Receiver receipt is self-attested and does not declare its trust model"));
  }
  let continuity = null;
  if (!failures.length && kit && response) {
    try {
      const answerKey = parseJson(kit.entries.get("benchmark/benchmark-answer-key.json"), "benchmark answer key");
      const embeddedBundle = loadAgentBundleBytes(preflight.entries.get("data/agent-bundle.zip"));
      const repository = new AgentRepository(embeddedBundle);
      continuity = evaluateContinuityResponse(repository, answerKey, response);
      if (!continuity.report.verified) failures.push(failure("CONTINUITY_BENCHMARK_FAILED", `Continuity Benchmark verdict ${continuity.report.verdict} at ${continuity.report.score}/100`, { verdict: continuity.report.verdict, score: continuity.report.score }));
      if (continuity.report.criticalIssues.length) failures.push(failure("CRITICAL_CONTINUITY_ERROR", continuity.report.criticalIssues.join(" | ")));
    } catch (error) { failures.push(failure("CONTINUITY_EVALUATION_FAILED", error instanceof Error ? error.message : String(error))); }
  }
  const status = failures.length ? (continuity ? "VERIFIED_FAIL" : "BLOCKED") : "VERIFIED_PASS";
  const generatedAt = options.generatedAt || new Date().toISOString();
  const report = {
    format: "kv-archive-verified-handoff-report",
    version: HANDOFF_VERSION,
    handoffId: preflight.handoffId,
    generatedAt,
    status,
    project: preflight.contract?.project || null,
    packageSha256: preflight.packageSha256,
    receiverReceiptId: receiverReceipt?.receiptId || null,
    continuity: continuity?.report || null,
    failures,
    warnings,
    approvedStateMutated: false,
  };
  const completionReceipt = {
    format: "kv-archive-handoff-completion-receipt",
    version: HANDOFF_VERSION,
    receiptId: `completion-${sha256Hex(stableStringify({ handoffId: report.handoffId, generatedAt, status, receiverReceiptId: report.receiverReceiptId, score: report.continuity?.score || null })).slice(0, 24)}`,
    handoffId: report.handoffId,
    generatedAt,
    status,
    packageSha256: report.packageSha256,
    receiverReceiptId: report.receiverReceiptId,
    benchmarkId: report.continuity?.benchmarkId || null,
    score: report.continuity?.score ?? null,
    verdict: report.continuity?.verdict || null,
    failureCodes: failures.map((item) => item.code),
    approvedStateMutated: false,
  };
  const markdown = [
    "# KV Archive Verified Handoff Report",
    "",
    `- Handoff: ${report.handoffId || "unknown"}`,
    `- Status: **${status}**`,
    `- Project: ${report.project ? `${report.project.title} (${report.project.id})` : "unknown"}`,
    `- Continuity: ${report.continuity ? `${report.continuity.verdict} · ${report.continuity.score}/100` : "not evaluated"}`,
    `- Approved state mutated: no`,
    "",
    "## Failures",
    "",
    ...(failures.length ? failures.map((item) => `- ${item.code}: ${item.message}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(warnings.length ? warnings.map((item) => `- ${item.code}: ${item.message}`) : ["- None"]),
    "",
  ].join("\n");
  if (options.outputDirectory) {
    const output = resolve(options.outputDirectory);
    await mkdir(output, { recursive: true });
    const reportPath = join(output, "verified-handoff-report.json");
    const markdownPath = join(output, "verified-handoff-report.md");
    const receiptPath = join(output, `handoff-completion-receipt-${completionReceipt.receiptId}.json`);
    for (const path of [reportPath, markdownPath, receiptPath]) {
      try { await access(path); throw new Error(`Refusing to overwrite ${path}`); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    await writeFile(markdownPath, markdown, { flag: "wx" });
    await writeFile(receiptPath, `${JSON.stringify(completionReceipt, null, 2)}\n`, { flag: "wx" });
    return { report, markdown, completionReceipt, files: { reportPath, markdownPath, receiptPath } };
  }
  return { report, markdown, completionReceipt };
}

export async function writeVerifiedHandoffPackages(repository, options = {}) {
  const result = createVerifiedHandoff(repository, options);
  const output = resolve(options.outputDirectory);
  await mkdir(output, { recursive: true });
  const receiverPath = join(output, result.receiver.filename);
  const kitPath = join(output, result.verificationKit.filename);
  const detachedReceiptPath = join(output, `sender-delivery-receipt-${result.handoffId}.json`);
  for (const path of [receiverPath, kitPath, detachedReceiptPath]) {
    try { await access(path); throw new Error(`Refusing to overwrite ${path}`); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  const detachedReceipt = {
    ...result.senderReceipt,
    format: "kv-archive-handoff-delivery-receipt",
    receiptId: `delivery-${result.handoffId}`,
    receiverPackage: basename(receiverPath),
    receiverPackageSha256: result.receiver.sha256,
    verificationKit: basename(kitPath),
    verificationKitSha256: result.verificationKit.sha256,
    receiverPayloadRootHash: result.receiver.manifest.payloadRootHash,
  };
  await Promise.all([
    writeFile(receiverPath, result.receiver.bytes, { flag: "wx" }),
    writeFile(kitPath, result.verificationKit.bytes, { flag: "wx" }),
    writeFile(detachedReceiptPath, `${JSON.stringify(detachedReceipt, null, 2)}\n`, { flag: "wx" }),
  ]);
  return { ...result, output, files: { receiverPath, verificationKitPath: kitPath, detachedReceiptPath } };
}

export const VERIFIED_HANDOFF_FORMATS = Object.freeze({ receiver: RECEIVER_FORMAT, verificationKit: KIT_FORMAT, version: HANDOFF_VERSION });
