import { compileKnowledgeGraph, renderCanonicalConversationBody, validateKnowledgeGraph } from "./packages/knowledge-graph/src/index.js";
import { renderObsidianNodeMarkdown, renderObsidianVault, sanitizeObsidianFilename } from "./packages/obsidian-exporter/src/index.js";
import { createStoredZipBlob } from "./zip.js";
import { sha256Hex } from "./vault-index.js";

const encoder = new TextEncoder();

function minimalCanonical(ref, projectId) {
  return {
    schemaVersion: "0.1",
    conversationId: ref.conversationId,
    title: ref.title || "Untitled conversation",
    source: { provider: "chatgpt", adapter: (ref.sourceKinds || [])[0] || "vault-index", sourceUrl: null },
    createdAt: ref.createdAt || null,
    updatedAt: ref.updatedAt || null,
    currentNodeId: null,
    nodes: {},
    edges: [],
    activePath: [],
    projectId,
    metadata: {},
    rawMetadata: null,
  };
}

function memoriesFromProfile(profile) {
  if (!profile) return [];
  const common = { version: profile.version, approvedAt: profile.approvedAt, sourceStateVersion: profile.sourceStateVersion };
  return [
    profile.core?.markdown ? { id: `approved-core-v${profile.version}`, mode: "core", title: `${profile.projectTitle} · Core Memory`, markdown: profile.core.markdown, hash: profile.core.hash, sources: profile.core.sources || [], ...common } : null,
    profile.project?.markdown ? { id: `approved-project-v${profile.version}`, mode: "project", title: `${profile.projectTitle} · Project Memory`, markdown: profile.project.markdown, hash: profile.project.hash, sources: profile.project.sources || [], ...common } : null,
  ].filter(Boolean);
}

function compactState(state, mode) {
  if (mode !== "compact") return state;
  return { ...state, decisions: [], tasks: [], supersessions: [] };
}

function rootFolder(projectTitle) {
  return `ContextVault-Obsidian-${sanitizeObsidianFilename(projectTitle, 70).replace(/\s+/g, "-")}`;
}

function entryBytes(entry) {
  return typeof entry.data === "string" ? encoder.encode(entry.data).byteLength : entry.data.byteLength;
}

function evidenceUri(reference, conversationById) {
  if (!reference?.conversationId || !reference?.nodeId) return null;
  const conversation = conversationById.get(reference.conversationId);
  if (!conversation?.currentEvidenceHash) return null;
  return `contextvault://conversation/${encodeURIComponent(reference.conversationId)}/node/${encodeURIComponent(reference.nodeId)}?evidence=${encodeURIComponent(conversation.currentEvidenceHash)}`;
}

function mergeProjectAssetGroup(group, inventory, stored, conversationIds, conversationById) {
  const title = stored.fileName || inventory.fileName || stored.fileId || inventory.fileId || "attachment";
  const relevantConversationIds = [...new Set((inventory.conversationIds || []).filter((id) => conversationIds.has(id)))];
  const evidenceUris = [...new Set((inventory.references || []).map((reference) => evidenceUri(reference, conversationById)).filter(Boolean))];
  if (!group) {
    return {
      id: stored.sha256 ? `sha256-${stored.sha256}` : stored.objectKey || inventory.key,
      title,
      mediaType: stored.mimeType || inventory.mimeType || null,
      byteLength: Number(stored.sizeBytes || inventory.expectedBytes || 0),
      contentHash: stored.sha256 ? `sha256:${stored.sha256}` : stored.objectKey || null,
      localPath: null,
      conversationIds: relevantConversationIds,
      evidenceUris,
      assetKey: stored.assetKey,
      objectKey: stored.objectKey || null,
      sha256: stored.sha256 || null,
    };
  }
  return {
    ...group,
    conversationIds: [...new Set([...(group.conversationIds || []), ...relevantConversationIds])],
    evidenceUris: [...new Set([...(group.evidenceUris || []), ...evidenceUris])],
  };
}

async function collectProjectAssets({ historyStore, historyJobId, projectId, refs, assetMode }) {
  const empty = {
    inputs: [],
    descriptors: [],
    historyJobId: null,
    stats: { mode: assetMode, matched: 0, materialized: 0, missing: 0, uniqueBytes: 0 },
  };
  if (assetMode !== "include" || !historyStore || !historyJobId) return empty;
  const job = await historyStore.getLatestJob(historyJobId);
  const inventory = Array.isArray(job?.assets?.inventory) ? job.assets.inventory : [];
  if (!job || inventory.length === 0) return empty;

  const conversationIds = new Set(refs.map((ref) => ref.conversationId));
  const conversationById = new Map(refs.map((ref) => [ref.conversationId, ref]));
  const matched = inventory.filter((asset) =>
    (asset.projectIds || []).includes(projectId)
      || (asset.conversationIds || []).some((id) => conversationIds.has(id))
  );
  if (matched.length === 0) return { ...empty, historyJobId: job.id };

  const storedRefs = await historyStore.listAssetRefs(job.id);
  const storedByKey = new Map(storedRefs.map((asset) => [asset.assetKey, asset]));
  const grouped = new Map();
  let missing = 0;
  for (const item of matched) {
    const stored = storedByKey.get(item.key);
    if (!stored?.objectKey) {
      missing += 1;
      continue;
    }
    const identity = stored.objectKey || stored.sha256 || stored.assetKey;
    grouped.set(identity, mergeProjectAssetGroup(grouped.get(identity), item, stored, conversationIds, conversationById));
  }

  const descriptors = [...grouped.values()].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return {
    inputs: descriptors.map(({ assetKey: _assetKey, objectKey: _objectKey, sha256: _sha256, ...input }) => input),
    descriptors,
    historyJobId: job.id,
    stats: {
      mode: assetMode,
      matched: matched.length,
      materialized: descriptors.length,
      missing,
      uniqueBytes: descriptors.reduce((total, item) => total + Number(item.byteLength || 0), 0),
    },
  };
}

function dynamicCount(volume) {
  return volume.conversationKeys.length + volume.assetNodeIds.length;
}

function planVolumes(staticEntries, conversations, assets, maxVolumeBytes) {
  const volumes = [];
  let current = {
    includeStatic: true,
    conversationKeys: [],
    assetNodeIds: [],
    estimatedBytes: staticEntries.reduce((total, entry) => total + entryBytes(entry), 0),
  };
  const append = (kind, descriptor) => {
    if (dynamicCount(current) && current.estimatedBytes + descriptor.estimatedBytes > maxVolumeBytes) {
      volumes.push(current);
      current = { includeStatic: false, conversationKeys: [], assetNodeIds: [], estimatedBytes: 0 };
    }
    if (kind === "conversation") current.conversationKeys.push(descriptor.key);
    else current.assetNodeIds.push(descriptor.nodeId);
    current.estimatedBytes += descriptor.estimatedBytes;
  };
  for (const descriptor of conversations) append("conversation", descriptor);
  for (const descriptor of assets) append("asset", descriptor);
  if (current.includeStatic || dynamicCount(current)) volumes.push(current);
  return volumes.map((volume, index) => ({ ...volume, number: index + 1 }));
}

export async function createKnowledgeExportPlan({
  store,
  historyStore = null,
  captureStore = null,
  historyJobId = null,
  projectId,
  structureMode = "standard",
  contentMode = "full",
  assetMode = "include",
  maxVolumeBytes = 24 * 1024 * 1024,
  generatedAt = new Date().toISOString(),
  onProgress = null,
}) {
  if (!projectId) throw new Error("请选择 Project");
  const [refs, state, approvedMemory, previous, contentObjects, contentRelations] = await Promise.all([
    store.listProjectConversationRefs(projectId),
    store.getProjectState(projectId),
    store.getApprovedMemory(projectId),
    store.getKnowledgeExportProfile(projectId),
    captureStore ? captureStore.list({ projectId, status: "all" }) : [],
    captureStore ? captureStore.listRelations(null, projectId) : [],
  ]);
  const graphContentObjects = contentObjects.filter((row) => row.status !== "trashed");
  if (!refs.length && !graphContentObjects.length) throw new Error("该 Project 暂无已索引对话或可导出的记录");
  const projectTitle = state?.projectTitle || refs[0]?.projectTitle || graphContentObjects[0]?.projectTitle || projectId;
  const assetSnapshot = await collectProjectAssets({ historyStore, historyJobId, projectId, refs, assetMode });
  const graph = await compileKnowledgeGraph({
    project: {
      id: projectId,
      title: projectTitle,
      summary: state?.status?.summary || "",
      updatedAt: state?.updatedAt || refs[0]?.updatedAt || null,
      sourceProvider: "chatgpt",
    },
    state: compactState(state, structureMode),
    memories: structureMode === "compact" ? [] : memoriesFromProfile(approvedMemory),
    conversations: refs.map((ref) => ({
      canonical: minimalCanonical(ref, projectId),
      evidenceHash: ref.currentEvidenceHash,
      archived: ref.archived,
      body: "",
      activeMessageCount: ref.activeMessageCount,
      totalNodeCount: ref.messageCount,
    })),
    assets: assetSnapshot.inputs,
    contentObjects: graphContentObjects,
    contentRelations,
    generatedAt,
  });
  const graphValidation = validateKnowledgeGraph(graph);
  if (!graphValidation.ok) throw new Error(`知识图谱校验失败：${graphValidation.issues.map((row) => row.code).join(", ")}`);

  const assetNodeByAssetId = new Map(
    graph.nodes.filter((node) => node.kind === "asset").map((node) => [node.properties.asset_id, node]),
  );
  const materializedAssetNodeIds = assetSnapshot.descriptors
    .map((asset) => assetNodeByAssetId.get(asset.id)?.id)
    .filter(Boolean);
  const vault = renderObsidianVault(graph, {
    generatedAt,
    previousPathMap: previous?.pathMap || {},
    materializedAssetNodeIds,
  });
  if (vault.report.status !== "COMPLETE") throw new Error(`Obsidian Vault 结构校验失败：${[...vault.report.brokenLinks, ...vault.report.invalidCanvasReferences].join("；")}`);

  const conversationNodeById = new Map(graph.nodes.filter((node) => node.kind === "conversation").map((node) => [node.properties.conversation_id, node]));
  const staticEntries = vault.entries.filter((entry) => !entry.nodeId?.startsWith("conversation:") && entry.kind !== "asset");
  const conversationDescriptors = [];
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index];
    const detail = await store.getConversationDetail(ref.key);
    if (!detail?.evidence?.canonical) throw new Error(`缺少会话证据：${ref.title || ref.conversationId}`);
    const node = conversationNodeById.get(ref.conversationId);
    if (!node) throw new Error(`图谱缺少会话节点：${ref.conversationId}`);
    const body = contentMode === "compact" ? "" : renderCanonicalConversationBody(detail.evidence.canonical);
    const markdown = renderObsidianNodeMarkdown(node, graph, vault.pathMap, { bodyOverride: body });
    conversationDescriptors.push({
      key: ref.key,
      conversationId: ref.conversationId,
      nodeId: node.id,
      path: vault.pathMap[node.id].path,
      evidenceHash: ref.currentEvidenceHash,
      estimatedBytes: encoder.encode(markdown).byteLength,
    });
    if (typeof onProgress === "function") onProgress({ phase: "measure", index: index + 1, total: refs.length, title: ref.title });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const assetDescriptors = assetSnapshot.descriptors.map((asset) => {
    const node = assetNodeByAssetId.get(asset.id);
    if (!node || !vault.pathMap[node.id]) throw new Error(`附件图谱路径缺失：${asset.title}`);
    return {
      nodeId: node.id,
      path: vault.pathMap[node.id].path,
      assetKey: asset.assetKey,
      objectKey: asset.objectKey,
      sha256: asset.sha256,
      title: asset.title,
      estimatedBytes: Number(asset.byteLength || 0),
    };
  });
  const volumes = planVolumes(staticEntries, conversationDescriptors, assetDescriptors, Math.max(1024 * 1024, maxVolumeBytes));
  const planId = await sha256Hex({
    graphHash: graph.graphHash,
    structureMode,
    contentMode,
    assetMode,
    maxVolumeBytes,
    conversations: conversationDescriptors.map((row) => [row.key, row.evidenceHash, row.estimatedBytes]),
    assets: assetDescriptors.map((row) => [row.nodeId, row.objectKey, row.sha256, row.estimatedBytes]),
    contentObjects: graphContentObjects.map((row) => [row.id, row.revision, row.contentHash, row.status]),
    contentRelations: contentRelations.map((row) => [row.id, row.fromId, row.relation, row.toId]),
    pathMap: vault.pathMap,
  });
  return {
    id: `knowledge-export:${planId}`,
    projectId,
    projectTitle,
    generatedAt,
    graphHash: graph.graphHash,
    graph,
    graphValidation,
    vault,
    refs,
    contentObjects: graphContentObjects,
    contentRelations,
    conversations: conversationDescriptors,
    assets: assetDescriptors,
    assetStats: assetSnapshot.stats,
    historyJobId: assetSnapshot.historyJobId,
    volumes,
    volumeCount: volumes.length,
    maxVolumeBytes,
    structureMode,
    contentMode,
    assetMode,
    rootFolder: rootFolder(projectTitle),
    previousProfile: previous?.profile || null,
  };
}

export async function buildKnowledgeExportVolume({ plan, volumeNumber, store, historyStore = null, onProgress = null }) {
  const volume = plan.volumes.find((item) => item.number === volumeNumber);
  if (!volume) throw new Error(`知识库分卷不存在：${volumeNumber}`);
  const entries = [];
  if (volume.includeStatic) {
    for (const entry of plan.vault.entries.filter((item) => !item.nodeId?.startsWith("conversation:") && item.kind !== "asset")) {
      entries.push({ name: `${plan.rootFolder}/${entry.path}`, data: entry.data });
    }
  }
  const descriptorByKey = new Map(plan.conversations.map((row) => [row.key, row]));
  const nodeById = new Map(plan.graph.nodes.map((node) => [node.id, node]));
  for (let index = 0; index < volume.conversationKeys.length; index += 1) {
    const key = volume.conversationKeys[index];
    const descriptor = descriptorByKey.get(key);
    const detail = await store.getConversationDetail(key);
    if (!descriptor || !detail?.evidence?.canonical) throw new Error(`无法读取会话分卷数据：${key}`);
    if (detail.conversation.currentEvidenceHash !== descriptor.evidenceHash) throw new Error(`会话在规划后发生变化，请重新生成预览：${detail.conversation.title}`);
    const node = nodeById.get(descriptor.nodeId);
    if (!node) throw new Error(`图谱节点不存在：${descriptor.nodeId}`);
    const body = plan.contentMode === "compact" ? "" : renderCanonicalConversationBody(detail.evidence.canonical);
    const markdown = renderObsidianNodeMarkdown(node, plan.graph, plan.vault.pathMap, { bodyOverride: body });
    entries.push({ name: `${plan.rootFolder}/${descriptor.path}`, data: markdown });
    if (typeof onProgress === "function") onProgress({ phase: "build", index: index + 1, total: volume.conversationKeys.length, title: detail.conversation.title, volume: volumeNumber, totalVolumes: plan.volumeCount });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const assetByNodeId = new Map((plan.assets || []).map((asset) => [asset.nodeId, asset]));
  for (let index = 0; index < (volume.assetNodeIds || []).length; index += 1) {
    const nodeId = volume.assetNodeIds[index];
    const descriptor = assetByNodeId.get(nodeId);
    if (!descriptor || !historyStore || !plan.historyJobId) throw new Error(`无法读取附件分卷数据：${nodeId}`);
    const asset = await historyStore.getAsset(plan.historyJobId, descriptor.assetKey);
    if (!asset?.bytes) throw new Error(`本地附件内容缺失：${descriptor.title}`);
    if (descriptor.objectKey && asset.objectKey !== descriptor.objectKey) throw new Error(`附件在规划后发生变化，请重新生成预览：${descriptor.title}`);
    if (descriptor.sha256 && asset.sha256 !== descriptor.sha256) throw new Error(`附件哈希发生变化，请重新生成预览：${descriptor.title}`);
    entries.push({ name: `${plan.rootFolder}/${descriptor.path}`, data: asset.bytes });
    if (typeof onProgress === "function") onProgress({ phase: "asset", index: index + 1, total: volume.assetNodeIds.length, title: descriptor.title, volume: volumeNumber, totalVolumes: plan.volumeCount });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  entries.push({
    name: `${plan.rootFolder}/99 System/volume-${String(volumeNumber).padStart(3, "0")}.json`,
    data: `${JSON.stringify({
      format: "context-vault-obsidian-volume",
      version: 2,
      planId: plan.id,
      projectId: plan.projectId,
      graphHash: plan.graphHash,
      volume: volumeNumber,
      totalVolumes: plan.volumeCount,
      conversations: volume.conversationKeys.length,
      assets: (volume.assetNodeIds || []).length,
      generatedAt: plan.generatedAt,
    }, null, 2)}\n`,
  });
  const suffix = plan.volumeCount > 1 ? `-part-${String(volumeNumber).padStart(3, "0")}` : "";
  return {
    blob: createStoredZipBlob(entries, new Date(plan.generatedAt)),
    filename: `${plan.rootFolder}${suffix}.zip`,
    entryCount: entries.length,
  };
}

export function resumableKnowledgeRun(plan, previousRun = null) {
  const reusable = previousRun?.planId === plan.id && previousRun?.graphHash === plan.graphHash;
  return {
    id: reusable ? previousRun.id : `${plan.projectId}:${Date.now()}`,
    projectId: plan.projectId,
    projectTitle: plan.projectTitle,
    planId: plan.id,
    graphHash: plan.graphHash,
    status: reusable ? previousRun.status : "planned",
    createdAt: reusable ? previousRun.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalVolumes: plan.volumeCount,
    completedVolumes: reusable ? [...new Set(previousRun.completedVolumes || [])].sort((a,b)=>a-b) : [],
    options: { structureMode: plan.structureMode, contentMode: plan.contentMode, assetMode: plan.assetMode, maxVolumeBytes: plan.maxVolumeBytes },
    lastError: null,
  };
}
