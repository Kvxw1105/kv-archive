import { hashStableJson } from "./content-hash.js";

function accountKey(job) {
  return job?.accountContext?.workspaceId || "personal";
}

function compactLocations(locations = []) {
  return locations
    .filter((item) => item?.present !== false)
    .map((item) => ({
      type: item.type || "regular",
      projectId: item.projectId || null,
      projectTitle: item.projectTitle || null,
      workspaceId: item.workspaceId || null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function currentConversationById(job) {
  return new Map((job?.conversations ?? []).map((item) => [item.id, item]));
}

export function snapshotReferenceKeys(snapshot) {
  return new Set([
    ...(snapshot?.conversations ?? []).map((item) => item.objectKey),
    ...(snapshot?.assets ?? []).map((item) => item.objectKey),
  ].filter(Boolean));
}

export function expandReferencedObjectKeys(initialKeys, objects = []) {
  const referenced = new Set(initialKeys ?? []);
  const metadataByKey = new Map((objects ?? []).filter((item) => item?.key).map((item) => [item.key, item]));
  const queue = [...referenced];
  const visited = new Set();
  while (queue.length > 0) {
    const key = queue.pop();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    const record = metadataByKey.get(key);
    for (const dependency of record?.references ?? []) {
      if (!dependency || referenced.has(dependency)) continue;
      referenced.add(dependency);
      queue.push(dependency);
    }
  }
  return referenced;
}

function diffRecords(previous = [], current = [], keyOf, signatureOf) {
  const before = new Map(previous.map((item) => [keyOf(item), item]));
  const after = new Map(current.map((item) => [keyOf(item), item]));
  const added = [];
  const updated = [];
  const removed = [];
  let unchanged = 0;
  for (const [key, item] of after) {
    if (!before.has(key)) added.push(key);
    else if (signatureOf(before.get(key)) !== signatureOf(item)) updated.push(key);
    else unchanged += 1;
  }
  for (const key of before.keys()) if (!after.has(key)) removed.push(key);
  return { added: added.sort(), updated: updated.sort(), removed: removed.sort(), unchanged };
}

export function compareLogicalSnapshots(previous, current) {
  const conversations = current?.conversations ?? [];
  const assets = current?.assets ?? [];
  const projects = current?.projects ?? [];
  return {
    conversations: diffRecords(
      previous?.conversations ?? [], conversations,
      (item) => item.conversationId,
      (item) => `${item.objectKey}|${JSON.stringify(item.locations ?? [])}`,
    ),
    assets: diffRecords(
      previous?.assets ?? [], assets,
      (item) => item.assetKey,
      (item) => item.objectKey,
    ),
    projects: diffRecords(
      previous?.projects ?? [], projects,
      (item) => item.id,
      (item) => item.title ?? "",
    ),
  };
}

function snapshotDelta(previous, conversations, assets, projects) {
  return compareLogicalSnapshots(previous, { conversations, assets, projects });
}

export async function createLogicalSnapshot({
  historyStore,
  snapshotStore,
  job,
  source = "manual",
  createdAt = new Date(),
  retention = { maxSnapshots: 30, maxAgeDays: 180 },
  runId = null,
}) {
  if (!job?.id) throw new Error("无法为缺少任务 ID 的备份创建快照");
  const [artifactRefs, assetRefs, existingSnapshots] = await Promise.all([
    historyStore.listArtifactRefs(job.id),
    historyStore.listAssetRefs(job.id),
    snapshotStore.listSnapshots({ jobId: job.id, accountKey: accountKey(job) }),
  ]);
  const metadataById = currentConversationById(job);
  const conversations = artifactRefs.filter((ref) => {
    const metadata = metadataById.get(ref.conversationId);
    const locations = Array.isArray(metadata?.locations) ? metadata.locations : [];
    return !metadata || locations.length === 0 || locations.some((location) => location?.present !== false);
  }).map((ref) => {
    const metadata = metadataById.get(ref.conversationId) ?? ref.metadata ?? {};
    return {
      conversationId: ref.conversationId,
      objectKey: ref.objectKey,
      sizeBytes: Number(ref.sizeBytes ?? 0),
      title: metadata.title ?? ref.title ?? null,
      updateTime: metadata.updateTime ?? null,
      locations: compactLocations(metadata.locations),
    };
  }).sort((a, b) => a.conversationId.localeCompare(b.conversationId));
  const assets = assetRefs.map((ref) => ({
    assetKey: ref.assetKey,
    objectKey: ref.objectKey,
    sizeBytes: Number(ref.sizeBytes ?? 0),
    sha256: ref.sha256 ?? null,
    mimeType: ref.mimeType ?? null,
    archivePath: ref.archivePath ?? null,
  })).sort((a, b) => a.assetKey.localeCompare(b.assetKey));
  const completedAssetKeys = new Set(assets.map((item) => item.assetKey));
  const unresolvedAssets = (job.assets?.inventory ?? [])
    .filter((item) => !completedAssetKeys.has(item.key))
    .map((item) => ({
      assetKey: item.key,
      fileId: item.fileId ?? null,
      fileName: item.fileName ?? null,
      mimeType: item.mimeType ?? null,
      expectedBytes: Number.isFinite(Number(item.expectedBytes)) ? Number(item.expectedBytes) : null,
      downloadable: Boolean(item.downloadable),
    }))
    .sort((a, b) => a.assetKey.localeCompare(b.assetKey));
  const projects = (job.projects ?? [])
    .filter((item) => item?.present !== false)
    .map((item) => ({ id: item.id, title: item.title ?? "未命名项目" }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const fingerprintPayload = {
    version: 1,
    accountKey: accountKey(job),
    conversations: conversations.map(({ title: _title, sizeBytes: _sizeBytes, ...item }) => item),
    assets: assets.map(({ sizeBytes: _sizeBytes, archivePath: _archivePath, ...item }) => item),
    unresolvedAssets: unresolvedAssets.map(({ fileName: _fileName, ...item }) => item),
    projects,
  };
  const fingerprint = await hashStableJson(fingerprintPayload);
  const latest = existingSnapshots[0] ?? null;
  if (latest?.fingerprint === fingerprint) {
    return {
      created: false,
      unchanged: true,
      snapshot: latest,
      retention: { deleted: [], kept: existingSnapshots.length },
      garbageCollection: { deletedObjects: 0, reclaimedBytes: 0 },
    };
  }
  const createdAtIso = createdAt.toISOString();
  const logicalBytes = conversations.reduce((sum, item) => sum + item.sizeBytes, 0)
    + assets.reduce((sum, item) => sum + item.sizeBytes, 0);
  const uniqueSizes = new Map();
  for (const item of [...conversations, ...assets]) {
    if (!uniqueSizes.has(item.objectKey)) uniqueSizes.set(item.objectKey, item.sizeBytes);
  }
  const physicalReferencedBytes = [...uniqueSizes.values()].reduce((sum, value) => sum + value, 0);
  const delta = snapshotDelta(latest, conversations, assets, projects);
  const snapshot = {
    id: `snapshot-${createdAtIso.replace(/[:.]/g, "-")}-${fingerprint.slice(0, 12)}`,
    version: 1,
    jobId: job.id,
    accountKey: accountKey(job),
    workspaceLabel: job.accountContext?.workspaceLabel ?? "个人空间",
    fingerprint,
    previousSnapshotId: latest?.id ?? null,
    source,
    runId,
    createdAt: createdAtIso,
    jobCompletedAt: job.completedAt ?? null,
    conversations,
    assets,
    unresolvedAssets,
    projects,
    delta,
    stats: {
      conversations: conversations.length,
      assets: assets.length,
      unresolvedAssets: unresolvedAssets.length,
      uniqueObjects: uniqueSizes.size,
      logicalBytes,
      physicalReferencedBytes,
      dedupSavedBytes: Math.max(0, logicalBytes - physicalReferencedBytes),
      incrementalObjectsInserted: Number(job.stats?.incrementalObjectsInserted ?? 0),
      incrementalObjectsReused: Number(job.stats?.incrementalObjectsReused ?? 0),
      incrementalBytesWritten: Number(job.stats?.incrementalBytesWritten ?? 0),
      incrementalBytesReused: Number(job.stats?.incrementalBytesReused ?? 0),
      incrementalNodesReused: Number(job.stats?.incrementalNodesReused ?? 0),
      incrementalMappingChunksReused: Number(job.stats?.incrementalMappingChunksReused ?? 0),
      conversationChanges: delta.conversations.added.length + delta.conversations.updated.length + delta.conversations.removed.length,
      assetChanges: delta.assets.added.length + delta.assets.updated.length + delta.assets.removed.length,
    },
  };
  await snapshotStore.saveSnapshot(snapshot);
  const retentionResult = await applySnapshotRetention({
    snapshotStore,
    historyStore,
    jobId: job.id,
    accountKey: snapshot.accountKey,
    retention,
    now: createdAt,
  });
  return { created: true, unchanged: false, snapshot, ...retentionResult };
}

export function selectSnapshotsToRetain(snapshots, retention = {}, now = new Date()) {
  const maxSnapshots = Math.max(1, Math.floor(Number(retention.maxSnapshots ?? 30)));
  const maxAgeDays = Math.max(1, Math.floor(Number(retention.maxAgeDays ?? 180)));
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const sorted = [...snapshots].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const keep = [];
  const remove = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const snapshot = sorted[index];
    const withinCount = index < maxSnapshots;
    const withinAge = new Date(snapshot.createdAt).getTime() >= cutoff;
    if (index === 0 || (withinCount && withinAge)) keep.push(snapshot);
    else remove.push(snapshot);
  }
  return { keep, remove };
}

export async function applySnapshotRetention({ snapshotStore, historyStore, jobId, accountKey: key, retention, now = new Date() }) {
  const snapshots = await snapshotStore.listSnapshots({ jobId, accountKey: key });
  const { keep, remove } = selectSnapshotsToRetain(snapshots, retention, now);
  for (const snapshot of remove) await snapshotStore.deleteSnapshot(snapshot.id);
  const directReferences = new Set(await historyStore.listCurrentObjectKeys(jobId));
  const allRemainingSnapshots = await snapshotStore.listSnapshots();
  for (const snapshot of allRemainingSnapshots) {
    for (const objectKey of snapshotReferenceKeys(snapshot)) directReferences.add(objectKey);
  }
  const objects = await snapshotStore.listContentObjectMetadata();
  const referenced = expandReferencedObjectKeys(directReferences, objects);
  let deletedObjects = 0;
  let reclaimedBytes = 0;
  for (const object of objects) {
    if (referenced.has(object.key)) continue;
    await snapshotStore.deleteContentObject(object.key);
    deletedObjects += 1;
    reclaimedBytes += Number(object.sizeBytes ?? 0);
  }
  return {
    retention: { deleted: remove.map((item) => item.id), kept: keep.length, accountKey: key },
    garbageCollection: { deletedObjects, reclaimedBytes },
  };
}
