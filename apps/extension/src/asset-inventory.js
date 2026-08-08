const asArray = (value) => Array.isArray(value) ? value : [];
const cleanText = (value) => typeof value === "string" ? value.trim() : "";

const MIME_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
};

export function safeAssetFilename(value, fallback = "attachment") {
  let name = cleanText(value) || fallback;
  try { name = decodeURIComponent(name); } catch {}
  name = name.split(/[\\/]/).pop() || fallback;
  return name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 180) || fallback;
}

export function addMimeExtension(filename, mimeType) {
  const safe = safeAssetFilename(filename);
  if (/\.[a-z0-9]{1,12}$/i.test(safe)) return safe;
  const mime = cleanText(mimeType).split(";")[0].toLowerCase();
  return safe + (MIME_EXTENSIONS[mime] || "");
}

export function extractFileId(value) {
  if (typeof value !== "string") return null;
  const sediment = value.match(/sediment:\/\/(file[_-][a-z0-9_-]+)/i);
  if (sediment?.[1]) return sediment[1];
  const direct = value.match(/\b(file[_-][a-z0-9_-]{6,})\b/i);
  return direct?.[1] ?? null;
}

function extractSandboxPaths(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/(?:sandbox:|sandbox:\/\/)(\/mnt\/data\/.+?)(?=[)\]}>"'\r\n]|$)/gi)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);
}

function normalizeBytes(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function inferKind({ mimeType, metadata, path, role, projectFile, sandboxPath }) {
  if (projectFile) return "project-file";
  if (metadata?.dalle || metadata?.generation || /dalle|generated_image/i.test(path)) return "dalle-image";
  if (sandboxPath || role === "tool" || /code|python|tool|sandbox|execution/i.test(path)) return "code-output";
  if (cleanText(mimeType).toLowerCase().startsWith("image/")) return role === "user" ? "user-image" : "image";
  if (/image_asset_pointer|image/i.test(path)) return role === "user" ? "user-image" : "image";
  return "attachment";
}

function createReference({
  fileId = null,
  sandboxPath = null,
  conversationId = null,
  projectId = null,
  projectTitle = null,
  nodeId = null,
  messageId = null,
  role = null,
  fileName = null,
  mimeType = null,
  sizeBytes = null,
  metadata = null,
  path = "",
  projectFile = false,
}) {
  const key = fileId
    ? `file:${fileId}`
    : `sandbox:${conversationId || projectId || "unknown"}:${sandboxPath || path}`;
  const resolvedName = addMimeExtension(
    fileName || (sandboxPath ? sandboxPath.split("/").pop() : fileId || "attachment"),
    mimeType,
  );
  return {
    key,
    fileId,
    sandboxPath,
    downloadable: Boolean(fileId),
    kind: inferKind({ mimeType, metadata, path, role, projectFile, sandboxPath }),
    fileName: resolvedName,
    mimeType: cleanText(mimeType) || null,
    expectedBytes: normalizeBytes(sizeBytes),
    conversationIds: conversationId ? [conversationId] : [],
    projectIds: projectId ? [projectId] : [],
    references: [{ conversationId, projectId, projectTitle, nodeId, messageId, role, path }],
  };
}

function filenameScore(name, fileId) {
  const value = cleanText(name);
  if (!value) return -1;
  if (value === fileId) return 0;
  return /\.[a-z0-9]{1,12}$/i.test(value) ? 2 : 1;
}

function mergeOne(existing, incoming) {
  if (!existing) return structuredClone(incoming);
  const referenceMap = new Map();
  for (const reference of [...(existing.references ?? []), ...(incoming.references ?? [])]) {
    const key = JSON.stringify([reference.conversationId, reference.projectId, reference.nodeId, reference.messageId, reference.path]);
    referenceMap.set(key, reference);
  }
  return {
    ...existing,
    ...incoming,
    fileId: incoming.fileId || existing.fileId,
    sandboxPath: incoming.sandboxPath || existing.sandboxPath,
    downloadable: Boolean(incoming.downloadable || existing.downloadable),
    kind: existing.kind === "attachment" ? incoming.kind : existing.kind,
    fileName: filenameScore(incoming.fileName, incoming.fileId || existing.fileId) > filenameScore(existing.fileName, incoming.fileId || existing.fileId) ? incoming.fileName : existing.fileName,
    mimeType: incoming.mimeType || existing.mimeType,
    expectedBytes: incoming.expectedBytes ?? existing.expectedBytes ?? null,
    conversationIds: [...new Set([...(existing.conversationIds ?? []), ...(incoming.conversationIds ?? [])])],
    projectIds: [...new Set([...(existing.projectIds ?? []), ...(incoming.projectIds ?? [])])],
    references: [...referenceMap.values()],
  };
}

export function mergeAssetInventory(existing = [], incoming = []) {
  const byKey = new Map();
  for (const item of [...existing, ...incoming]) {
    if (!item?.key) continue;
    byKey.set(item.key, mergeOne(byKey.get(item.key), item));
  }
  return [...byKey.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function collectObjectCandidate(value, context) {
  if (!value || typeof value !== "object") return [];
  const assetPointer = cleanText(value.asset_pointer ?? value.assetPointer ?? value.url);
  const fileId = cleanText(value.file_id ?? value.fileId) || extractFileId(assetPointer) || null;
  const sandboxPath = cleanText(value.sandbox_path ?? value.sandboxPath) || extractSandboxPaths(assetPointer)[0] || null;
  if (!fileId && !sandboxPath) return [];
  const metadata = value.metadata && typeof value.metadata === "object" ? value.metadata : null;
  return [createReference({
    ...context,
    fileId,
    sandboxPath,
    fileName: value.file_name ?? value.filename ?? value.name ?? value.title ?? metadata?.filename ?? null,
    mimeType: value.mime_type ?? value.mimeType ?? (typeof value.content_type === "string" && value.content_type.includes("/") ? value.content_type : null) ?? (typeof value.type === "string" && value.type.includes("/") ? value.type : null) ?? metadata?.mime_type ?? null,
    sizeBytes: value.size_bytes ?? value.sizeBytes ?? value.size ?? metadata?.size_bytes ?? null,
    metadata,
  })];
}

function walkValue(value, context, output, visited, depth = 0) {
  if (depth > 18 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const fileId = extractFileId(value);
    if (fileId && /file|asset|attachment|image|upload|sandbox|content/i.test(context.path)) output.push(createReference({ ...context, fileId }));
    for (const sandboxPath of extractSandboxPaths(value)) output.push(createReference({ ...context, sandboxPath, fileName: sandboxPath.split("/").pop() }));
    return;
  }
  if (typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  output.push(...collectObjectCandidate(value, context));
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkValue(child, { ...context, path: `${context.path}[${index}]` }, output, visited, depth + 1));
    return;
  }
  for (const [key, child] of Object.entries(value)) walkValue(child, { ...context, path: context.path ? `${context.path}.${key}` : key }, output, visited, depth + 1);
}

export function collectConversationAssetReferences(raw, metadata = {}) {
  const conversationId = cleanText(raw?.id ?? raw?.conversation_id ?? metadata?.id) || null;
  const projectLocation = asArray(metadata?.locations).find((location) => location?.type === "project" && location.present !== false)
    ?? asArray(metadata?.locations).find((location) => location?.type === "project")
    ?? null;
  const output = [];
  for (const [nodeId, node] of Object.entries(raw?.mapping ?? {})) {
    const message = node?.message;
    if (!message) continue;
    const context = {
      conversationId,
      projectId: projectLocation?.projectId ?? raw?.gizmo_id ?? null,
      projectTitle: projectLocation?.projectTitle ?? null,
      nodeId,
      messageId: message.id ?? null,
      role: message.author?.role ?? null,
      path: `mapping.${nodeId}.message`,
    };
    walkValue(message.content, { ...context, path: `${context.path}.content` }, output, new Set());
    walkValue(message.metadata, { ...context, path: `${context.path}.metadata` }, output, new Set());
  }
  return mergeAssetInventory([], output);
}

export function collectProjectAssetReferences(projects = []) {
  const output = [];
  for (const project of projects) {
    for (const [index, file] of asArray(project?.files).entries()) {
      const wrapper = file?.file && typeof file.file === "object" ? file.file : file;
      const fileId = cleanText(wrapper?.file_id ?? wrapper?.fileId ?? wrapper?.id ?? file?.file_id ?? file?.id) || null;
      if (!fileId) continue;
      output.push(createReference({
        fileId,
        projectId: project.id ?? null,
        projectTitle: project.title ?? null,
        fileName: wrapper?.name ?? wrapper?.file_name ?? wrapper?.filename ?? file?.name ?? null,
        mimeType: wrapper?.mime_type ?? wrapper?.type ?? file?.type ?? null,
        sizeBytes: wrapper?.size_bytes ?? wrapper?.size ?? file?.size ?? null,
        path: `projects.${project.id}.files[${index}]`,
        projectFile: true,
      }));
    }
  }
  return mergeAssetInventory([], output);
}

export function assetArchivePath(asset) {
  const id = safeAssetFilename(asset.fileId || asset.key.replace(/[^a-z0-9_-]+/gi, "-") || "asset");
  return `assets/${id}_${safeAssetFilename(asset.fileName || "attachment")}`;
}

/**
 * Incrementally merges asset references into a caller-owned Map. This avoids
 * repeatedly rebuilding and sorting the complete inventory while scanning a
 * large conversation corpus.
 */
export function mergeAssetInventoryInto(target, incoming = []) {
  if (!(target instanceof Map)) throw new TypeError("target must be a Map");
  for (const item of incoming) {
    if (!item?.key) continue;
    target.set(item.key, mergeOne(target.get(item.key), item));
  }
  return target;
}

export function assetInventoryFromMap(target) {
  if (!(target instanceof Map)) throw new TypeError("target must be a Map");
  return [...target.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
}
