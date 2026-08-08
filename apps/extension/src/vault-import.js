import { normalizeChatGPTConversation } from "./packages/normalizer/src/index.js";
import { validateCanonicalConversation } from "./packages/domain/src/index.js";
import { readZipEntries, decodeZipText } from "./zip-reader.js";
import { buildVaultIndexBundle, sha256Hex } from "./vault-index.js";

function parseJson(bytes, name) {
  try { return JSON.parse(decodeZipText(bytes)); }
  catch (error) { throw new Error(`无法解析 ${name}：${error instanceof Error ? error.message : String(error)}`); }
}

function siblingPath(path, fileName) {
  const index = path.lastIndexOf("/");
  return `${index >= 0 ? path.slice(0, index + 1) : ""}${fileName}`;
}

function sourceFromPath(path, fileName, fingerprint) {
  return { kind: "context-vault", fileName, fingerprint, entryPath: path };
}

async function extractContextVaultCandidates(archives) {
  const candidates = [];
  for (const archive of archives) {
    const canonicalPaths = [...archive.entries.keys()].filter((name) => name.endsWith("/canonical.json") || name === "canonical.json");
    for (const path of canonicalPaths) {
      const canonical = parseJson(archive.entries.get(path), path);
      const validation = validateCanonicalConversation(canonical);
      if (!validation.ok) continue;
      const rawPath = siblingPath(path, "raw.json");
      const metadataPath = siblingPath(path, "source-metadata.json");
      candidates.push({
        canonical,
        rawEvidence: archive.entries.has(rawPath) ? parseJson(archive.entries.get(rawPath), rawPath) : canonical.rawMetadata ?? canonical,
        sourceMetadata: archive.entries.has(metadataPath) ? parseJson(archive.entries.get(metadataPath), metadataPath) : null,
        source: sourceFromPath(path, archive.name || "ContextVault.zip", archive.fingerprint || "unknown"),
      });
    }
  }
  return candidates;
}

async function extractOfficialCandidates(archive) {
  const candidates = [];
  const names = [...archive.entries.keys()].filter((name) => /(^|\/)(?:shared_)?conversations(?:[-_ ]?\d+)?\.json$/i.test(name));
  for (const name of names) {
    const payload = parseJson(archive.entries.get(name), name);
    const conversations = Array.isArray(payload) ? payload : Array.isArray(payload?.conversations) ? payload.conversations : [];
    for (const raw of conversations) {
      try {
        const canonical = normalizeChatGPTConversation(raw, { adapter: "openai-official-export", sourceUrl: null });
        candidates.push({
          canonical,
          rawEvidence: raw,
          sourceMetadata: { officialExportEntry: name, archived: Boolean(raw?.is_archived), projectTitle: null },
          source: { kind: "openai-official", fileName: archive.name, fingerprint: archive.fingerprint, entryPath: name },
        });
      } catch {
        // Official exports may contain non-conversation records; preserve aggregate warning at report level.
      }
    }
  }
  return candidates;
}

export async function inspectImportArchives(files, options = {}) {
  const archives = [];
  for (const file of files) {
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const fingerprint = await sha256Hex(bytes);
    const lower = String(file.name || "").toLowerCase();
    if (lower.endsWith(".json")) {
      archives.push({ name: file.name, fingerprint, entries: new Map([[file.name, bytes]]), directJson: true });
    } else {
      archives.push({ name: file.name, fingerprint, entries: await readZipEntries(bytes, options) });
    }
  }
  const contextVault = await extractContextVaultCandidates(archives);
  const official = [];
  for (const archive of archives) official.push(...await extractOfficialCandidates(archive));
  if (contextVault.length === 0 && official.length === 0) throw new Error("未找到 ContextVault canonical.json 或 OpenAI conversations.json");
  return {
    archives,
    candidates: [...contextVault, ...official],
    detected: { contextVault: contextVault.length, official: official.length },
  };
}

export async function importCandidatesIntoVault({ candidates, store, onProgress = () => {}, importMetadata = {} }) {
  const report = { files: importMetadata.files ?? 0, detected: importMetadata.detected ?? { contextVault: candidates.length, official: 0 }, total: candidates.length, inserted: 0, updated: 0, duplicate: 0, stale: 0, failed: 0, failures: [] };
  let index = 0;
  for (const candidate of candidates) {
    index += 1;
    try {
      onProgress({ phase: "indexing", index, total: candidates.length, title: candidate.canonical.title });
      const bundle = await buildVaultIndexBundle(candidate);
      const result = await store.upsertBundle(bundle);
      report[result.status] = (report[result.status] || 0) + 1;
      onProgress({ phase: "indexed", index, total: candidates.length, title: candidate.canonical.title, status: result.status });
    } catch (error) {
      report.failed += 1;
      report.failures.push({ title: candidate.canonical?.title || "未知对话", error: error instanceof Error ? error.message : String(error) });
    }
  }
  const importRecord = {
    id: `import:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    importedAt: new Date().toISOString(),
    fileNames: importMetadata.fileNames ?? [],
    fingerprints: importMetadata.fingerprints ?? [],
    report,
  };
  await store.putImport(importRecord);
  return report;
}

export async function importArchivesIntoVault({ files, store, onProgress = () => {}, options = {} }) {
  const inspected = await inspectImportArchives(files, options);
  return importCandidatesIntoVault({
    candidates: inspected.candidates,
    store,
    onProgress,
    importMetadata: {
      files: files.length,
      detected: inspected.detected,
      fileNames: files.map((item) => item.name),
      fingerprints: inspected.archives.map((item) => item.fingerprint),
    },
  });
}
