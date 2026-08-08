import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { buildVaultIndexBundle, sha256Hex } from "../apps/extension/dist/vault-index.js";
import { buildAgentBundle } from "../apps/extension/dist/agent-bundle.js";
import { createEmptyProjectState, stableStateStringify } from "../apps/extension/dist/state-governance.js";
import { openAgentRepository, readStoredZipEntries } from "../apps/agent-bridge/dist/agent/agent-core.js";
import { createStoredZip } from "../apps/agent-bridge/dist/agent/zip-writer.js";
import { sha256Hex as agentSha256Hex, stableStringify as agentStableStringify } from "../apps/agent-bridge/dist/agent/bundle-builder.js";
import { createVerifiedHandoff, preflightVerifiedHandoffBytes, receiveVerifiedHandoff, verifyHandoffResponse, writeVerifiedHandoffPackages } from "../apps/agent-bridge/dist/agent/verified-handoff.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/synthetic/multi-branch-conversation.json", import.meta.url), "utf8"));

async function makeBundle(options = {}) {
  const raw = structuredClone(fixture);
  raw.id = "conv-handoff-project";
  raw.title = "Verified Handoff Project";
  const canonical = normalizeChatGPTConversation(raw, { adapter: "handoff-test" });
  const indexed = await buildVaultIndexBundle({
    canonical,
    rawEvidence: raw,
    source: { kind: "chatgpt", fileName: "handoff.json", fingerprint: "handoff" },
    sourceMetadata: { locations: [{ type: "project", present: true, projectId: "project-handoff", projectTitle: "Verified Handoff" }] },
    importedAt: "2026-07-29T08:00:00.000Z",
  });
  const evidenceMessage = indexed.messages.find((row) => row.activePath && row.role === "assistant") || indexed.messages[0];
  const evidenceUri = `contextvault://conversation/${encodeURIComponent(indexed.conversation.conversationId)}/node/${encodeURIComponent(evidenceMessage.nodeId)}?evidence=${encodeURIComponent(evidenceMessage.evidenceHash)}`;
  const state = createEmptyProjectState("project-handoff", "Verified Handoff");
  state.stateVersion = 3;
  state.status = {
    summary: "Prepare a governed receiving-Agent handoff.",
    phase: "verification",
    health: "on_track",
    progressPercent: 75,
    blockers: [],
    nextActions: ["Run receiver preflight", "Return the continuity response"],
  };
  state.decisions = [{
    id: "decision-read-only",
    title: "Approved state remains read-only",
    summary: "Receiving Agents may only create review-required proposals.",
    status: "active",
    consequences: [],
    evidenceUris: options.missingEvidence ? [] : [evidenceUri],
    createdAt: "2026-07-29T08:10:00.000Z",
    updatedAt: null,
    supersededAt: null,
    supersededByProposalId: null,
  }];
  state.tasks = [{
    id: "task-preflight",
    title: "Run deterministic preflight",
    status: "in_progress",
    priority: "high",
    owner: "receiver",
    dueDate: null,
    notes: "Verify package integrity before extracting any file.",
    evidenceUris: [evidenceUri],
    createdAt: "2026-07-29T08:11:00.000Z",
    updatedAt: null,
    supersededAt: null,
    supersededByProposalId: null,
  }];
  state.stateHash = await sha256Hex(stableStateStringify(state));
  const built = await buildAgentBundle({ conversations: [indexed.conversation], messages: indexed.messages, evidence: [indexed.evidence], states: [state] }, { sourceAppVersion: "0.15.0" });
  return { built, state, evidenceUri };
}

async function withRepository(fn, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "kv-handoff-"));
  try {
    const { built, state, evidenceUri } = await makeBundle(options);
    const bundlePath = join(directory, built.filename);
    await writeFile(bundlePath, built.bytes);
    const repository = await openAgentRepository(bundlePath);
    return await fn({ directory, bundlePath, repository, state, evidenceUri });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function json(entries, name) { return JSON.parse(new TextDecoder().decode(entries.get(name))); }

function repackReceiver(result, mutate) {
  const original = readStoredZipEntries(result.receiver.bytes);
  const entries = new Map([...original.entries()].filter(([name]) => name !== "manifest.json"));
  mutate(entries);
  const metadata = [...entries.entries()].map(([name, data]) => ({ name, bytes: data.length, sha256: agentSha256Hex(data) })).sort((a, b) => a.name.localeCompare(b.name));
  const manifest = {
    ...result.receiver.manifest,
    entries: metadata,
    payloadRootHash: agentSha256Hex(agentStableStringify(metadata)),
  };
  return createStoredZip([
    { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
    ...[...entries.entries()].map(([name, data]) => ({ name, data })),
  ], new Date("2026-07-29T09:00:00.000Z"));
}

function perfectResponse(answerKey) {
  return {
    format: "kv-archive-continuity-response",
    version: 1,
    project: answerKey.expected.project,
    status: answerKey.expected.status,
    decisions: answerKey.expected.decisions,
    tasks: answerKey.expected.tasks,
    blockers: answerKey.expected.blockers,
    nextActions: answerKey.expected.nextActions,
    evidenceUris: answerKey.expected.evidenceUris,
    uncertainties: [],
  };
}

test("Verified Handoff creates separate receiver and private verification packages", async () => withRepository(async ({ repository }) => {
  const result = createVerifiedHandoff(repository, { project: "Verified Handoff", query: "Continue the verified handoff", generatedAt: "2026-07-29T09:00:00.000Z" });
  assert.match(result.handoffId, /^kvh-/);
  const receiverEntries = readStoredZipEntries(result.receiver.bytes);
  const kitEntries = readStoredZipEntries(result.verificationKit.bytes);
  assert(receiverEntries.has("data/agent-bundle.zip"));
  assert(receiverEntries.has("benchmark/benchmark-challenge.json"));
  assert(![...receiverEntries.keys()].some((name) => /answer-key/i.test(name)));
  assert(kitEntries.has("benchmark/benchmark-answer-key.json"));
  const preflight = preflightVerifiedHandoffBytes(result.receiver.bytes);
  assert.equal(preflight.status, "PASS", JSON.stringify(preflight.failures));
  assert.equal(preflight.stats.projects, 1);
  assert.equal(preflight.contract.project.id, "project-handoff");
  assert.equal(preflight.scopedBundle.manifest.filters.projectId, "project-handoff");
}));

test("Verified Handoff blocks unresolved Memory Gate review unless explicitly allowed", async () => withRepository(async ({ repository }) => {
  assert.throws(() => createVerifiedHandoff(repository, { project: "Verified Handoff", generatedAt: "2026-07-29T09:00:00.000Z" }), /requires review/);
  const allowed = createVerifiedHandoff(repository, { project: "Verified Handoff", allowReview: true, generatedAt: "2026-07-29T09:00:00.000Z" });
  assert.equal(allowed.senderReceipt.status, "READY_WITH_EXPLICIT_EXCEPTIONS");
  const preflight = preflightVerifiedHandoffBytes(allowed.receiver.bytes);
  assert.equal(preflight.status, "PASS");
  assert(preflight.warnings.some((item) => item.code === "MEMORY_GATE_REVIEW_ALLOWED"));
}, { missingEvidence: true }));

test("Receiver preflight detects a payload hash mismatch", async () => withRepository(async ({ repository }) => {
  const result = createVerifiedHandoff(repository, { project: "Verified Handoff", generatedAt: "2026-07-29T09:00:00.000Z" });
  const original = readStoredZipEntries(result.receiver.bytes);
  const entries = [...original.entries()].map(([name, data]) => ({ name, data: name === "context/CONTEXT_PACK.md" ? new TextEncoder().encode("tampered") : data }));
  const tampered = createStoredZip(entries, new Date("2026-07-29T09:00:00.000Z"));
  const preflight = preflightVerifiedHandoffBytes(tampered);
  assert.equal(preflight.status, "BLOCKED");
  assert(preflight.failures.some((item) => item.code === "PACKAGE_ENTRY_SIZE_MISMATCH" || item.code === "PACKAGE_ENTRY_HASH_MISMATCH"));
}));


test("Receiver package blocks a declared private answer key even when outer hashes are valid", async () => withRepository(async ({ repository }) => {
  const result = createVerifiedHandoff(repository, { project: "Verified Handoff", generatedAt: "2026-07-29T09:00:00.000Z" });
  const poisoned = repackReceiver(result, (entries) => {
    entries.set("benchmark/benchmark-answer-key.json", new TextEncoder().encode('{"private":true}\n'));
  });
  const preflight = preflightVerifiedHandoffBytes(poisoned);
  assert.equal(preflight.status, "BLOCKED");
  assert(preflight.failures.some((item) => item.code === "PRIVATE_ANSWER_KEY_EXPOSED"));
}));

test("Receiver package cross-checks source Bundle identity between contract and sender receipt", async () => withRepository(async ({ repository }) => {
  const result = createVerifiedHandoff(repository, { project: "Verified Handoff", sourceBundleSha256: "a".repeat(64), generatedAt: "2026-07-29T09:00:00.000Z" });
  const inconsistent = repackReceiver(result, (entries) => {
    const contract = json(entries, "contract/handoff-contract.json");
    contract.sourceBundle.sha256 = "b".repeat(64);
    entries.set("contract/handoff-contract.json", new TextEncoder().encode(`${JSON.stringify(contract, null, 2)}\n`));
  });
  const preflight = preflightVerifiedHandoffBytes(inconsistent);
  assert.equal(preflight.status, "BLOCKED");
  assert(preflight.failures.some((item) => item.code === "SOURCE_BUNDLE_HASH_MISMATCH"));
}));

test("Receiver materialization writes an append-only preflight receipt and no answer key", async () => withRepository(async ({ repository, directory }) => {
  const created = await writeVerifiedHandoffPackages(repository, { project: "Verified Handoff", query: "Continue safely", outputDirectory: join(directory, "sender"), generatedAt: "2026-07-29T09:00:00.000Z" });
  const received = await receiveVerifiedHandoff(created.files.receiverPath, join(directory, "receiver"), { receiver: "Codex", generatedAt: "2026-07-29T09:05:00.000Z" });
  assert.equal(received.receipt.status, "PASS");
  assert.equal(received.receipt.approvedStateMutated, false);
  await readFile(received.files.bundle);
  await readFile(received.files.contextPack, "utf8");
  await readFile(received.files.receiverReceipt, "utf8");
  await assert.rejects(() => readFile(join(directory, "receiver", "benchmark-answer-key.json")), /ENOENT/);
  await assert.rejects(() => receiveVerifiedHandoff(created.files.receiverPath, join(directory, "receiver"), { receiver: "Codex", generatedAt: "2026-07-29T09:05:00.000Z" }), /Refusing to overwrite|EEXIST/);
}));

test("Post-run verification passes only with matching package, receipt and response", async () => withRepository(async ({ repository, directory }) => {
  const created = await writeVerifiedHandoffPackages(repository, { project: "Verified Handoff", query: "Continue safely", outputDirectory: join(directory, "sender"), generatedAt: "2026-07-29T09:00:00.000Z" });
  const received = await receiveVerifiedHandoff(created.files.receiverPath, join(directory, "receiver"), { receiver: "Codex", generatedAt: "2026-07-29T09:05:00.000Z" });
  const kitEntries = readStoredZipEntries(new Uint8Array(await readFile(created.files.verificationKitPath)));
  const answerKey = json(kitEntries, "benchmark/benchmark-answer-key.json");
  await writeFile(received.files.response, `${JSON.stringify(perfectResponse(answerKey), null, 2)}\n`);
  const verified = await verifyHandoffResponse({
    handoffPath: created.files.receiverPath,
    verificationKitPath: created.files.verificationKitPath,
    receiverReceiptPath: received.files.receiverReceipt,
    responsePath: received.files.response,
    outputDirectory: join(directory, "verification"),
    generatedAt: "2026-07-29T09:10:00.000Z",
  });
  assert.equal(verified.report.status, "VERIFIED_PASS", JSON.stringify(verified.report.failures));
  assert.equal(verified.report.continuity.verdict, "PASS");
  assert.equal(verified.completionReceipt.approvedStateMutated, false);
}));

test("Post-run verification fails unsupported facts and invalid evidence", async () => withRepository(async ({ repository, directory }) => {
  const created = await writeVerifiedHandoffPackages(repository, { project: "Verified Handoff", outputDirectory: join(directory, "sender"), generatedAt: "2026-07-29T09:00:00.000Z" });
  const received = await receiveVerifiedHandoff(created.files.receiverPath, join(directory, "receiver"), { receiver: "Codex", generatedAt: "2026-07-29T09:05:00.000Z" });
  const bad = {
    format: "kv-archive-continuity-response",
    version: 1,
    project: { id: "wrong", title: "Wrong" },
    status: { summary: "invented", phase: null, health: null, progressPercent: null },
    decisions: [{ id: "invented", title: "Invented", status: "active" }],
    tasks: [], blockers: [], nextActions: [],
    evidenceUris: ["contextvault://conversation/fake/node/fake?evidence=fake"],
    uncertainties: [],
  };
  await writeFile(received.files.response, `${JSON.stringify(bad, null, 2)}\n`);
  const verified = await verifyHandoffResponse({ handoffPath: created.files.receiverPath, verificationKitPath: created.files.verificationKitPath, receiverReceiptPath: received.files.receiverReceipt, responsePath: received.files.response, generatedAt: "2026-07-29T09:10:00.000Z" });
  assert.equal(verified.report.status, "VERIFIED_FAIL");
  assert(verified.report.failures.some((item) => item.code === "CONTINUITY_BENCHMARK_FAILED"));
  assert(verified.report.failures.some((item) => item.code === "CRITICAL_CONTINUITY_ERROR"));
}));


test("Packaged CLI completes create, receive, and verify workflow", async () => withRepository(async ({ bundlePath, directory }) => {
  const sender = join(directory, "cli-sender");
  const create = spawnSync(process.execPath, [
    "apps/agent-bridge/dist/agent/index.js", "handoff-create",
    "--bundle", bundlePath,
    "--project", "Verified Handoff",
    "--query", "Continue safely",
    "--output", sender,
    "--generated-at", "2026-07-29T09:00:00.000Z",
  ], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr || create.stdout);
  const created = JSON.parse(create.stdout);
  assert.match(created.receiverPackage, /KV-Archive-Verified-Handoff-/);
  assert.match(created.verificationKit, /KV-Archive-Handoff-Verification-Kit-/);

  const receiver = join(directory, "cli-receiver");
  const receive = spawnSync(process.execPath, [
    "apps/agent-bridge/dist/agent/index.js", "handoff-receive",
    "--handoff", created.receiverPackage,
    "--output", receiver,
    "--receiver", "Codex",
    "--generated-at", "2026-07-29T09:05:00.000Z",
  ], { encoding: "utf8" });
  assert.equal(receive.status, 0, receive.stderr || receive.stdout);
  const received = JSON.parse(receive.stdout);
  assert.equal(received.status, "PASS");

  const kitEntries = readStoredZipEntries(new Uint8Array(await readFile(created.verificationKit)));
  const answerKey = json(kitEntries, "benchmark/benchmark-answer-key.json");
  const responsePath = join(receiver, "handoff-response.json");
  await writeFile(responsePath, `${JSON.stringify(perfectResponse(answerKey), null, 2)}
`);
  const receiptName = (await readdir(receiver)).find((name) => name.startsWith("receiver-preflight-receipt-"));
  assert(receiptName);
  const verification = join(directory, "cli-verification");
  const verify = spawnSync(process.execPath, [
    "apps/agent-bridge/dist/agent/index.js", "handoff-verify",
    "--handoff", created.receiverPackage,
    "--verification-kit", created.verificationKit,
    "--receiver-receipt", join(receiver, receiptName),
    "--response", responsePath,
    "--output", verification,
    "--generated-at", "2026-07-29T09:10:00.000Z",
  ], { encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  const verified = JSON.parse(verify.stdout);
  assert.equal(verified.status, "VERIFIED_PASS");
  const report = JSON.parse(await readFile(join(verification, "verified-handoff-report.json"), "utf8"));
  assert.equal(report.continuity.verdict, "PASS");
}));
