import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeStateProposal } from "./state-governance.js";

function hashText(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function clean(value, max = 20_000) { return String(value ?? "").trim().slice(0, max); }

function prepareChange(kind, change = {}, seed) {
  const value = structuredClone(change || {});
  if (kind === "decision") {
    const record = value.record || value;
    if (!record.id) record.id = `decision-${hashText(`${seed}:${record.title || "decision"}`).slice(0, 12)}`;
    if (value.record) value.record = record;
  } else if (kind === "task") {
    const record = value.record || value;
    if (!record.id) record.id = `task-${hashText(`${seed}:${record.title || "task"}`).slice(0, 12)}`;
    if (value.record) value.record = record;
  } else if (kind === "supersession" && value.replacement && !value.replacement.id) {
    const prefix = value.recordType === "task" ? "task" : "decision";
    value.replacement.id = `${prefix}-${hashText(`${seed}:${value.replacement.title || "replacement"}`).slice(0, 12)}`;
  }
  return value;
}

export function buildStateProposal(repository, draft = {}, metadata = {}) {
  const projectIdentifier = clean(draft.projectId || draft.projectTitle || draft.project);
  if (!projectIdentifier) throw new Error("projectId, projectTitle, or project is required");
  const state = repository.projectState(projectIdentifier);
  if (!state) throw new Error(`Project state not found in bundle: ${projectIdentifier}`);
  if (!state.stateHash) throw new Error("Project state is missing a base hash");
  const evidenceUris = [...new Set((Array.isArray(draft.evidenceUris) ? draft.evidenceUris : []).map((value) => clean(value, 4_000)).filter(Boolean))];
  if (!evidenceUris.length) throw new Error("At least one evidence URI is required");
  const invalid = evidenceUris.filter((uri) => !repository.hasProvenanceUri(uri));
  if (invalid.length) throw new Error(`Evidence URI is not present in this bundle: ${invalid.join(", ")}`);
  const createdAt = metadata.createdAt || new Date().toISOString();
  const seed = `${repository.manifest.bundleId}:${state.projectId}:${draft.kind}:${draft.title}:${createdAt}:${randomUUID()}`;
  const id = `cvp-${hashText(seed).slice(0, 24)}`;
  return normalizeStateProposal({
    format: "context-vault-state-proposal",
    schemaVersion: 1,
    id,
    createdAt,
    projectId: state.projectId,
    projectTitle: state.projectTitle,
    baseVersion: state.stateVersion,
    baseStateHash: state.stateHash,
    kind: draft.kind,
    title: draft.title,
    rationale: draft.rationale,
    expectedImpact: draft.expectedImpact,
    riskLevel: draft.riskLevel,
    evidenceUris,
    change: prepareChange(draft.kind, draft.change, id),
    agent: {
      name: clean(draft.agentName || metadata.agentName, 300) || "local-agent",
      client: clean(draft.client || metadata.client, 300) || null,
      bundleId: repository.manifest.bundleId,
    },
  });
}

export async function writeStateProposal(repository, draft, options = {}) {
  const proposal = buildStateProposal(repository, draft, options);
  const outputDir = resolve(options.outputDir || "./context-vault-proposals");
  await mkdir(outputDir, { recursive: true });
  const path = resolve(outputDir, `${proposal.id}.json`);
  await writeFile(path, `${JSON.stringify(proposal, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { path, proposal };
}
