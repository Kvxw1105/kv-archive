import {
  assetInventoryFromMap,
  collectConversationAssetReferences,
  collectProjectAssetReferences,
  mergeAssetInventoryInto,
} from "./asset-inventory.js";

const clone = (value) => structuredClone(value);

function activeLocations(metadata) {
  return Array.isArray(metadata?.locations)
    ? metadata.locations.filter((location) => location?.present !== false)
    : [];
}

function summarizeConversations(conversations) {
  let regular = 0;
  let archived = 0;
  let projectConversations = 0;
  for (const metadata of conversations) {
    const types = new Set(activeLocations(metadata).map((location) => location.type));
    if (types.has("regular")) regular += 1;
    if (types.has("archived")) archived += 1;
    if (types.has("project") || types.has("collection")) projectConversations += 1;
  }
  return { regular, archived, projectConversations };
}

function relevantProjectIds(conversations) {
  const ids = new Set();
  for (const metadata of conversations) {
    if (metadata?.projectId) ids.add(metadata.projectId);
    for (const location of activeLocations(metadata)) {
      if ((location.type === "project" || location.type === "collection") && location.projectId) ids.add(location.projectId);
    }
  }
  return ids;
}

/**
 * Builds a read-only export snapshot from the artifacts that are already
 * durable in the history store. It never changes the resumable capture job.
 */
export async function createSavedHistoryExportSnapshot({ job, store, generatedAt = new Date() }) {
  if (!job?.id) throw new Error("没有可导出的采集任务");
  const durableIds = new Set(await store.listArtifactIds(job.id));
  const conversationIds = new Set((job.conversations ?? []).map((item) => item.id));
  const completedIds = [...durableIds].filter((id) => conversationIds.has(id));
  const completedSet = new Set(completedIds);
  const conversations = (job.conversations ?? []).filter((item) => completedSet.has(item.id));
  if (!conversations.length) throw new Error("还没有已保存的会话可导出");

  const projectIds = relevantProjectIds(conversations);
  const projects = (job.projects ?? []).filter((project) => projectIds.has(project.id));
  const inventoryMap = new Map();
  for (const metadata of conversations) {
    const artifact = await store.getArtifact(job.id, metadata.id);
    if (!artifact) continue;
    mergeAssetInventoryInto(inventoryMap, collectConversationAssetReferences(artifact.raw, metadata));
  }
  mergeAssetInventoryInto(inventoryMap, collectProjectAssetReferences(projects));
  const inventory = assetInventoryFromMap(inventoryMap);
  const inventoryKeys = new Set(inventory.map((item) => item.key));
  const storedAssets = typeof store.listAssetMetadata === "function"
    ? await store.listAssetMetadata(job.id)
    : [];
  const storedByKey = new Map(storedAssets.map((item) => [item.assetKey, item]));
  const completedAssetKeys = (job.assets?.completedKeys ?? []).filter((key) => inventoryKeys.has(key) && storedByKey.has(key));
  const downloadedBytes = completedAssetKeys.reduce((total, key) => total + Number(storedByKey.get(key)?.sizeBytes ?? 0), 0);

  const selectedTotal = Number(job.selection?.total ?? job.conversations?.length ?? conversations.length);
  const savedCount = conversations.length;
  const remainingCount = Math.max(0, selectedTotal - savedCount);
  const failedCount = (job.failures ?? []).filter((failure) => !completedSet.has(failure.id)).length;
  const isPartial = remainingCount > 0;
  const locationCounts = summarizeConversations(conversations);
  const timestamp = generatedAt.toISOString();
  const snapshot = clone(job);
  snapshot.scope = isPartial ? "selected-conversations-partial" : job.scope;
  snapshot.status = isPartial ? "partial_export" : job.status;
  snapshot.current = null;
  snapshot.conversations = clone(conversations);
  snapshot.projects = clone(projects);
  snapshot.completedIds = [...completedIds];
  snapshot.completedVersions = Object.fromEntries(Object.entries(job.completedVersions ?? {}).filter(([id]) => completedSet.has(id)));
  snapshot.failures = [];
  snapshot.assets = {
    ...(clone(job.assets ?? {})),
    status: job.assetPolicy === "download" ? (completedAssetKeys.length ? "partial" : "pending") : "inventory_only",
    inventory,
    completedKeys: completedAssetKeys,
    failures: (job.assets?.failures ?? []).filter((failure) => inventoryKeys.has(failure.key)),
    unsupportedKeys: inventory.filter((item) => !item.downloadable).map((item) => item.key),
    totalBytes: inventory.reduce((total, item) => total + (Number(item.expectedBytes) || 0), 0),
    downloadedBytes,
    scannedConversationIds: [...completedIds],
  };
  snapshot.stats = {
    ...(clone(job.stats ?? {})),
    indexed: conversations.length,
    completed: savedCount,
    failed: 0,
    regular: locationCounts.regular,
    archived: locationCounts.archived,
    projects: projects.length,
    projectConversations: locationCounts.projectConversations,
    assetsDiscovered: inventory.length,
    assetsDownloaded: completedAssetKeys.length,
    assetFailures: snapshot.assets.failures.length,
    unsupportedAssets: snapshot.assets.unsupportedKeys.length,
    assetBytes: downloadedBytes,
  };
  snapshot.captureProgress = {
    sourceJobId: job.id,
    selectionId: job.selection?.id ?? null,
    selectionTitle: job.selection?.title ?? null,
    selectedTotal,
    savedCount,
    remainingCount,
    failedCount,
    isPartial,
    sourceStatus: job.status,
    generatedAt: timestamp,
  };
  snapshot.warnings = [...(job.warnings ?? [])];
  if (isPartial) snapshot.warnings.push(`这是阶段性导出：已保存 ${savedCount}/${selectedTotal} 条，剩余 ${remainingCount} 条可稍后继续采集。`);
  snapshot.completedAt = timestamp;
  snapshot.updatedAt = timestamp;
  snapshot.archiveExport = { status: "snapshot", planId: null, totalVolumes: 0, completedVolumes: [], updatedAt: timestamp };
  return snapshot;
}
