import { normalizeChatGPTConversation } from "./packages/normalizer/src/index.js";
import { validateCanonicalConversation } from "./packages/domain/src/index.js";
import { readZipEntries, decodeZipText } from "./zip-reader.js";
import { buildVaultIndexBundle, sha256Hex } from "./vault-index.js";

const officialPath = /(^|\/)(?:shared_)?conversations(?:[-_ ]?\d+)?\.json$/i;
const vaultPath = /(^|\/)canonical\.json$/;
const sibling = (path, name) => path.slice(0, path.lastIndexOf("/") + 1) + name;
const parsedPlans = new WeakMap();
const outcomes = ["inserted", "updated", "duplicate", "stale"];
const counts = () => ({ inserted: 0, updated: 0, duplicate: 0, stale: 0, failed: 0, preservedProject: 0 });
const errorText = (error) => error instanceof Error ? error.message : String(error);

function parseJson(bytes) {
  try { return JSON.parse(decodeZipText(bytes)); }
  catch { throw new Error("JSON 格式无效"); }
}

function issue(row, unit, entryPath, recordNumber, reason) {
  row.issues.push({ unit, entryPath, recordNumber, reason });
}

function extractCandidates(entries, row, candidates, detected) {
  const source = (kind, entryPath, recordNumber) => ({
    kind, fileName: row.name, fingerprint: row.fingerprint, entryPath,
    fileNumber: row.fileNumber, recordNumber,
  });
  for (const [path, data] of entries) {
    if (officialPath.test(path)) {
      row.shards += 1;
      let records;
      try {
        const payload = parseJson(data);
        records = Array.isArray(payload) ? payload : payload?.conversations;
        if (!Array.isArray(records)) throw new Error("未找到对话数组");
      } catch (error) {
        issue(row, "shard", path, null, errorText(error));
        continue;
      }
      for (const [index, raw] of records.entries()) {
        const recordNumber = index + 1;
        row.records += 1;
        try {
          const canonical = normalizeChatGPTConversation(raw, {
            adapter: "openai-official-export", captureMode: "official-import", completeness: "unknown",
          });
          if (!Object.keys(canonical.nodes).length) throw new Error("会话没有节点");
          candidates.push({
            canonical, rawEvidence: raw, source: source("openai-official", path, recordNumber),
            sourceMetadata: {
              officialExportEntry: path,
              archived: raw.is_archived === true,
              projectTitle: canonical.collectionRefs?.[0]?.title ?? null,
            },
          });
          row.ready += 1;
          detected.official += 1;
        } catch (error) {
          issue(row, "record", path, recordNumber, errorText(error));
        }
      }
    } else if (vaultPath.test(path)) {
      row.shards += 1;
      row.records += 1;
      const rawPath = sibling(path, "raw.json");
      const metadataPath = sibling(path, "source-metadata.json");
      try {
        const canonical = parseJson(data);
        const validation = validateCanonicalConversation(canonical);
        if (!validation.ok) throw new Error("KV Archive 会话结构无效");
        candidates.push({
          canonical,
          rawEvidence: entries.has(rawPath) ? parseJson(entries.get(rawPath)) : canonical.rawMetadata ?? canonical,
          sourceMetadata: entries.has(metadataPath) ? parseJson(entries.get(metadataPath)) : null,
          source: source("context-vault", path, 1),
        });
        row.ready += 1;
        detected.contextVault += 1;
      } catch (error) {
        issue(row, "record", path, 1, errorText(error));
      }
    }
  }
}

function summarize(inputFiles) {
  const total = { files: inputFiles.length, shards: 0, records: 0, ready: 0, rejected: 0, blockedUnits: 0, ignoredEntries: 0 };
  for (const row of inputFiles) {
    for (const key of ["shards", "records", "ready", "ignoredEntries"]) total[key] += row[key];
    total.rejected += row.records - row.ready;
    total.blockedUnits += row.issues.filter(({ unit }) => unit === "file" || unit === "shard").length;
  }
  return total;
}

/** Reads only input files. Neither the library nor a database handle is required. */
export async function previewImportArchives(files, options = {}) {
  const candidates = [];
  const inputFiles = [];
  const detected = { contextVault: 0, official: 0 };
  const onFile = options.onFile ?? (() => {});
  for (const [index, file] of Array.from(files).entries()) {
    const name = String(file.name || "未命名文件");
    const row = { fileNumber: index + 1, name, fingerprint: null, shards: 0, records: 0, ready: 0, ignoredEntries: 0, issues: [] };
    inputFiles.push(row);
    onFile({ fileNumber: row.fileNumber, name });
    try {
      // Blob/File.bytes is a method in current browsers; only read preloaded data values.
      const supplied = typeof file.bytes === "function" ? undefined : file.bytes;
      const bytes = supplied instanceof Uint8Array ? supplied : new Uint8Array(supplied ?? await file.arrayBuffer());
      row.fingerprint = await sha256Hex(bytes);
      let entries;
      if (name.toLowerCase().endsWith(".json")) {
        entries = new Map([[name, bytes]]);
      } else if (name.toLowerCase().endsWith(".zip")) {
        const supportPaths = new Map();
        entries = await readZipEntries(bytes, {
          ...options,
          includeEntry(path) {
            const selected = officialPath.test(path) || vaultPath.test(path) || /(^|\/)(raw|source-metadata)\.json$/.test(path);
            if (!selected) row.ignoredEntries += 1;
            return selected;
          },
          onEntryError(path, error) {
            if (officialPath.test(path) || vaultPath.test(path)) {
              row.shards += 1;
              issue(row, "shard", path, null, errorText(error));
            } else {
              supportPaths.set(path, errorText(error));
            }
          },
        });
        // If associated raw/metadata is corrupt, do not silently substitute or index that conversation.
        for (const [path, reason] of supportPaths) {
          const canonicalPath = sibling(path, "canonical.json");
          if (entries.delete(canonicalPath)) {
            row.shards += 1;
            row.records += 1;
            issue(row, "record", canonicalPath, 1, path + "：" + reason);
          } else if (!row.issues.some((item) => item.entryPath === canonicalPath)) {
            issue(row, "shard", path, null, reason);
          }
        }
      } else {
        throw new Error("只支持 ZIP 或 JSON 文件");
      }
      extractCandidates(entries, row, candidates, detected);
      if (!row.shards && !row.issues.length) issue(row, "file", null, null, "未找到 KV Archive 会话或 OpenAI conversations*.json");
    } catch (error) {
      issue(row, "file", null, null, errorText(error));
    }
  }
  const totals = summarize(inputFiles);
  const summary = { ...totals, detected, inputFiles };
  const plan = structuredClone(summary);
  // Keep trusted backup locations ahead of official data when both arrive together.
  const ordered = [...candidates.filter(({source}) => source.kind === "context-vault"), ...candidates.filter(({source}) => source.kind === "openai-official")];
  parsedPlans.set(plan, { summary, candidates: ordered });
  return plan;
}

// Compatibility entry point for existing callers expecting rejection on empty selections.
export async function inspectImportArchives(files, options = {}) {
  const plan = await previewImportArchives(files, options);
  const { candidates } = parsedPlans.get(plan);
  if (!candidates.length) throw new Error(plan.inputFiles.flatMap((row) => row.issues)[0]?.reason ?? "未找到可导入的对话");
  return { ...plan, candidates, archives: plan.inputFiles };
}

export async function importCandidatesIntoVault({ candidates, store, onProgress = () => {}, importMetadata = {} }) {
  const planSummary = importMetadata.planSummary;
  const byFile = planSummary ? structuredClone(planSummary.inputFiles).map((row) => ({ ...row, rejected: row.records - row.ready, ...counts() })) : [];
  const nonce = crypto.randomUUID();
  const report = {
    files: importMetadata.files ?? planSummary?.files ?? 0,
    detected: importMetadata.detected ?? planSummary?.detected ?? { contextVault: candidates.length, official: 0 },
    total: planSummary?.records ?? candidates.length,
    ready: candidates.length, rejected: planSummary?.rejected ?? 0, blockedUnits: planSummary?.blockedUnits ?? 0,
    ignoredEntries: planSummary?.ignoredEntries ?? 0,
    ...counts(), failures: [],
    ...(planSummary ? { schemaVersion: 1, id: null, finishedAt: null, inputFiles: byFile, receiptStored: true } : {}),
  };
  for (const [offset, candidate] of candidates.entries()) {
    const index = offset + 1;
    const row = byFile[candidate.source.fileNumber - 1];
    const progress = { index, total: candidates.length, title: candidate.canonical.title };
    onProgress({ phase: "indexing", ...progress });
    let result;
    try {
      result = await store.upsertBundle(await buildVaultIndexBundle(candidate));
      if (!outcomes.includes(result.status)) throw new Error("无法识别索引写入结果");
    } catch (error) {
      report.failed += 1;
      const reason = errorText(error);
      report.failures.push({ title: candidate.canonical?.title || "未知对话", error: reason });
      if (row) {
        row.failed += 1;
        issue(row, "write", candidate.source.entryPath, candidate.source.recordNumber, reason);
      }
      continue;
    }
    report[result.status] += 1;
    if (row) row[result.status] += 1;
    if (result.projectPreserved) {
      report.preservedProject += 1;
      if (row) row.preservedProject += 1;
    }
    onProgress({ phase: "indexed", ...progress, status: result.status });
  }
  const finishedAt = new Date().toISOString();
  const id = (planSummary ? "receipt:" : "import:") + finishedAt + ":" + nonce;
  if (planSummary) {
    report.finishedAt = finishedAt;
    report.id = id;
    const accepted = outcomes.some((key) => report[key] > 0);
    const trouble = report.failed + report.rejected + report.blockedUnits;
    report.status = !accepted ? "failed" : trouble ? "partial" : "complete";
  }
  try {
    await store.putImport({
      id, importedAt: finishedAt,
      fileNames: importMetadata.fileNames ?? byFile.map((row) => row.name),
      fingerprints: importMetadata.fingerprints ?? byFile.map((row) => row.fingerprint),
      report,
    });
  } catch (error) {
    if (!planSummary) throw error;
    report.receiptStored = false;
    report.receiptError = errorText(error);
  }
  return report;
}

export async function commitImportPlan({ plan, store, onProgress }) {
  const work = parsedPlans.get(plan);
  if (!work?.candidates.length) throw new Error("预检无可导入记录，或本批已执行；请重新选择文件");
  parsedPlans.delete(plan);
  return importCandidatesIntoVault({ ...work, store, onProgress, importMetadata: { planSummary: work.summary } });
}

export async function importArchivesIntoVault({ files, store, onProgress, options }) {
  const plan = await previewImportArchives(files, options);
  return commitImportPlan({ plan, store, onProgress });
}
