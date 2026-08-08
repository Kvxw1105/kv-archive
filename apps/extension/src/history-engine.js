import { conversationMetadata } from "./history-api.js";
import { createConversationSelectionSet, selectionJobId } from "./conversation-selection.js";
import { assetArchivePath, assetInventoryFromMap, collectConversationAssetReferences, collectProjectAssetReferences, mergeAssetInventoryInto } from "./asset-inventory.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const yieldToBrowser = () => wait(0);
const clone = (value) => structuredClone(value);

export const HISTORY_JOB_VERSION = 3;
// Keep the legacy ID so v0.3.0 IndexedDB artifacts migrate in place.
export const DEFAULT_HISTORY_JOB_ID = "regular-history-v1";

function offsetPagination(limit = 28) {
  return {
    offset: 0,
    limit,
    consecutiveEmptyPages: 0,
    indexingComplete: false,
    reportedTotal: null,
    scanIds: [],
  };
}

function cursorPagination(initialCursor = null) {
  return {
    started: false,
    nextCursor: initialCursor,
    indexingComplete: false,
    pages: 0,
    scanIds: [],
  };
}

function assetState() {
  return {
    status: "pending",
    inventory: [],
    completedKeys: [],
    failures: [],
    unsupportedKeys: [],
    totalBytes: 0,
    downloadedBytes: 0,
    scannedConversationIds: [],
  };
}

export function createHistoryJob(id = DEFAULT_HISTORY_JOB_ID, now = new Date()) {
  const timestamp = now.toISOString();
  return {
    version: HISTORY_JOB_VERSION,
    id,
    scope: "all-conversations",
    provider: "chatgpt",
    selection: null,
    status: "idle",
    assetPolicy: "references-only",
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    accountContext: null,
    sources: {
      regular: { type: "regular", pagination: offsetPagination(), status: "pending" },
      archived: { type: "archived", pagination: offsetPagination(), status: "pending" },
      projects: { type: "projects", pagination: cursorPagination(null), status: "pending" },
    },
    projects: [],
    conversations: [],
    completedIds: [],
    completedVersions: {},
    failures: [],
    assets: assetState(),
    archiveExport: {
      status: "idle",
      planId: null,
      totalVolumes: 0,
      completedVolumes: [],
      updatedAt: null,
    },
    current: null,
    warnings: [],
    stats: {
      indexed: 0,
      completed: 0,
      failed: 0,
      retries: 0,
      regular: 0,
      archived: 0,
      projects: 0,
      projectConversations: 0,
      assetsDiscovered: 0,
      assetsDownloaded: 0,
      assetFailures: 0,
      unsupportedAssets: 0,
      assetBytes: 0,
      incrementalObjectsInserted: 0,
      incrementalObjectsReused: 0,
      incrementalBytesWritten: 0,
      incrementalBytesReused: 0,
      incrementalNodesReused: 0,
      incrementalMappingChunksReused: 0,
    },
  };
}

function locationKey(location) {
  return `${location?.type ?? "regular"}:${location?.projectId ?? ""}:${location?.workspaceId ?? ""}`;
}

export function createSelectedConversationJob(selectionInput, options = {}) {
  const selection = selectionInput?.items ? selectionInput : createConversationSelectionSet(selectionInput ?? {});
  if (!selection.items.length) throw new Error("请至少选择一条会话");
  const providers = new Set(selection.items.map((item) => item.provider));
  if (providers.size > 1 && !options.allowMixedProviders) {
    throw new Error("当前采集任务一次只能从一个平台读取；跨平台会话可在进入本地资料库后统一导出。 ");
  }
  const job = createHistoryJob(options.id ?? selectionJobId(selection), options.now ?? new Date());
  job.scope = "selected-conversations";
  job.provider = selection.provider ?? selection.items[0]?.provider ?? options.provider ?? "chatgpt";
  job.selection = {
    id: selection.id,
    title: selection.title,
    fingerprint: selection.fingerprint,
    itemKeys: selection.items.map((item) => item.key),
    total: selection.items.length,
  };
  job.assetPolicy = options.assetPolicy ?? "references-only";
  job.accountContext = options.accountContext ?? {
    provider: job.provider,
    workspaceId: selection.accountScopeId ?? selection.items[0]?.accountScopeId ?? null,
    workspaceLabel: options.accountLabel ?? "当前平台空间",
  };
  for (const source of Object.values(job.sources)) {
    source.status = "completed";
    source.pagination.indexingComplete = true;
  }
  job.conversations = selection.items.map((item) => ({
    id: item.conversationId,
    provider: item.provider,
    title: item.title,
    createTime: item.createdAt,
    updateTime: item.updatedAt,
    isArchived: item.isArchived,
    projectId: item.primaryCollectionId,
    projectTitle: item.collectionRefs?.find((entry) => entry.collectionId === item.primaryCollectionId)?.title ?? null,
    workspaceId: item.accountScopeId,
    collectionRefs: item.collectionRefs ?? [],
    locations: [{
      type: item.primaryCollectionId ? "collection" : item.isArchived ? "archived" : "regular",
      projectId: item.primaryCollectionId,
      projectTitle: item.collectionRefs?.find((entry) => entry.collectionId === item.primaryCollectionId)?.title ?? null,
      workspaceId: item.accountScopeId,
      provider: item.provider,
      present: true,
    }],
    url: item.url,
    raw: item.sourceMetadata,
  }));
  recalculateStats(job);
  return job;
}

export function isConversationPresent(metadata) {
  const locations = Array.isArray(metadata?.locations) ? metadata.locations : [];
  return locations.length === 0 || locations.some((location) => location?.present !== false);
}

function normalizeMetadata(rawItem, context = {}) {
  if (!rawItem || typeof rawItem !== "object") return null;
  if (typeof rawItem.id === "string" && Array.isArray(rawItem.locations)) {
    return clone(rawItem);
  }
  return conversationMetadata(rawItem, context);
}

function mergeLocations(left = [], right = []) {
  const byKey = new Map();
  for (const item of [...left, ...right]) {
    if (!item || typeof item !== "object") continue;
    byKey.set(locationKey(item), { ...item });
  }
  return [...byKey.values()];
}

function versionKey(metadata) {
  const value = metadata?.updateTime ?? metadata?.createTime ?? "";
  return value === null || value === undefined ? "" : String(value);
}

function recalculateStats(job) {
  job.stats ??= {};
  job.stats.indexed = job.conversations.length;
  job.stats.completed = job.completedIds.length;
  job.stats.failed = job.failures.length;
  job.stats.retries ??= 0;
  let regular = 0;
  let archived = 0;
  let projectConversations = 0;
  for (const item of job.conversations) {
    let hasRegular = false;
    let hasArchived = false;
    let hasProject = false;
    for (const location of item.locations ?? []) {
      if (location.present === false) continue;
      if (location.type === "regular") hasRegular = true;
      else if (location.type === "archived") hasArchived = true;
      else if (location.type === "project") hasProject = true;
    }
    if (hasRegular) regular += 1;
    if (hasArchived) archived += 1;
    if (hasProject) projectConversations += 1;
  }
  job.stats.regular = regular;
  job.stats.archived = archived;
  job.stats.projectConversations = projectConversations;
  let projects = 0;
  for (const project of job.projects) if (project.present !== false) projects += 1;
  job.stats.projects = projects;
  job.assets ??= assetState();
  job.stats.assetsDiscovered = job.assets.inventory?.length ?? 0;
  job.stats.assetsDownloaded = job.assets.completedKeys?.length ?? 0;
  job.stats.assetFailures = job.assets.failures?.length ?? 0;
  job.stats.unsupportedAssets = job.assets.unsupportedKeys?.length ?? 0;
  job.stats.assetBytes = job.assets.downloadedBytes ?? 0;
  return job;
}

function touch(job, now = new Date(), refresh = false) {
  job.updatedAt = now.toISOString();
  return refresh ? recalculateStats(job) : job;
}

function checkpoint(job, now = new Date()) {
  return touch(job, now, true);
}

function checkpointWriter({ store, job, everyItems = 50, everyMs = 5_000 }) {
  let pendingItems = 0;
  let lastSavedAt = Date.now();
  return async function persist(force = false) {
    pendingItems += 1;
    const due = force || pendingItems >= everyItems || Date.now() - lastSavedAt >= everyMs;
    if (!due) return false;
    await store.saveJob(checkpoint(job));
    pendingItems = 0;
    lastSavedAt = Date.now();
    return true;
  };
}

function normalizeSourceState(source, fallback) {
  return {
    ...fallback,
    ...(source ?? {}),
    pagination: { ...fallback.pagination, ...(source?.pagination ?? {}) },
  };
}

export function migrateHistoryJob(input) {
  if (!input) return null;
  if (input.version === HISTORY_JOB_VERSION) {
    const job = clone(input);
    const baseline = createHistoryJob(job.id, new Date(job.startedAt ?? Date.now()));
    job.scope = job.scope === "selected-conversations" ? "selected-conversations" : "all-conversations";
    job.provider = typeof job.provider === "string" && job.provider ? job.provider : "chatgpt";
    job.selection = job.selection && typeof job.selection === "object" ? job.selection : null;
    job.sources = {
      regular: normalizeSourceState(job.sources?.regular, baseline.sources.regular),
      archived: normalizeSourceState(job.sources?.archived, baseline.sources.archived),
      projects: normalizeSourceState(job.sources?.projects, baseline.sources.projects),
    };
    job.projects = Array.isArray(job.projects) ? job.projects : [];
    job.conversations = Array.isArray(job.conversations) ? job.conversations.map((item) => normalizeMetadata(item)).filter(Boolean) : [];
    job.completedIds = Array.isArray(job.completedIds) ? [...new Set(job.completedIds)] : [];
    job.completedVersions = job.completedVersions && typeof job.completedVersions === "object" ? job.completedVersions : {};
    job.failures = Array.isArray(job.failures) ? job.failures : [];
    job.assets = {
      ...assetState(),
      ...(job.assets ?? {}),
      inventory: Array.isArray(job.assets?.inventory) ? job.assets.inventory : [],
      completedKeys: Array.isArray(job.assets?.completedKeys) ? [...new Set(job.assets.completedKeys)] : [],
      failures: Array.isArray(job.assets?.failures) ? job.assets.failures : [],
      unsupportedKeys: Array.isArray(job.assets?.unsupportedKeys) ? [...new Set(job.assets.unsupportedKeys)] : [],
      scannedConversationIds: Array.isArray(job.assets?.scannedConversationIds) ? [...new Set(job.assets.scannedConversationIds)] : [],
    };
    job.warnings = Array.isArray(job.warnings) ? job.warnings : [];
    job.archiveExport = {
      status: "idle",
      planId: null,
      totalVolumes: 0,
      completedVolumes: [],
      updatedAt: null,
      ...(job.archiveExport ?? {}),
      completedVolumes: Array.isArray(job.archiveExport?.completedVolumes) ? [...new Set(job.archiveExport.completedVolumes)] : [],
    };
    for (const id of job.completedIds) {
      if (!(id in job.completedVersions)) {
        const metadata = job.conversations.find((item) => item.id === id);
        job.completedVersions[id] = versionKey(metadata);
      }
    }
    return checkpoint(job);
  }

  if (input.version === 2) {
    const job = clone(input);
    job.version = HISTORY_JOB_VERSION;
    job.assets = assetState();
    job.warnings = Array.isArray(job.warnings) ? job.warnings : [];
    job.warnings.push("已从 v0.4.0 对话备份任务升级；既有对话缓存将用于建立附件清单，不会重复下载对话。");
    return migrateHistoryJob(job);
  }

  if (input.version === 1 || input.pagination) {
    const migrated = createHistoryJob(input.id ?? DEFAULT_HISTORY_JOB_ID, new Date(input.startedAt ?? Date.now()));
    migrated.startedAt = input.startedAt ?? migrated.startedAt;
    migrated.updatedAt = input.updatedAt ?? migrated.updatedAt;
    migrated.sources.regular.pagination = { ...offsetPagination(), ...(input.pagination ?? {}) };
    migrated.sources.regular.status = migrated.sources.regular.pagination.indexingComplete ? "complete" : "pending";
    migrated.conversations = (input.conversations ?? []).map((item) => normalizeMetadata(item, { sourceType: "regular" })).filter(Boolean);
    migrated.completedIds = [...new Set(input.completedIds ?? [])];
    migrated.failures = clone(input.failures ?? []);
    migrated.stats.retries = input.stats?.retries ?? 0;
    for (const id of migrated.completedIds) {
      const metadata = migrated.conversations.find((item) => item.id === id);
      migrated.completedVersions[id] = versionKey(metadata);
    }
    migrated.status = "indexing";
    migrated.completedAt = null;
    migrated.warnings.push("已从 v0.3.0 普通历史任务迁移；既有对话和本地缓存不会重复下载。");
    return touch(migrated);
  }

  return null;
}

export async function withRetry(operation, options = {}) {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 700;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const status = error?.status ?? null;
      const retryable = status === 429 || status === 408 || status === 409 || status === null || status >= 500;
      const shouldContinue = typeof options.shouldContinue !== "function" || options.shouldContinue();
      if (!retryable || !shouldContinue || attempt >= maxAttempts) break;
      const delay = error?.retryAfterMs ?? Math.min(15_000, baseDelayMs * (2 ** (attempt - 1)));
      options.onRetry?.({ attempt, delay, error });
      await wait(delay);
    }
  }
  throw lastError;
}

function removeFailure(job, conversationId) {
  job.failures = job.failures.filter((failure) => failure.id !== conversationId);
}

function upsertFailure(job, metadata, error) {
  removeFailure(job, metadata.id);
  job.failures.push({
    id: metadata.id,
    title: metadata.title,
    locations: clone(metadata.locations ?? []),
    error: error instanceof Error ? error.message : String(error),
    status: error?.status ?? null,
    diagnostic: error?.diagnostic ? clone(error.diagnostic) : null,
    at: new Date().toISOString(),
  });
}

function markChangedConversationForRefresh(job, metadata) {
  if (!job.completedIds.includes(metadata.id)) return;
  const completedVersion = job.completedVersions?.[metadata.id] ?? "";
  const incomingVersion = versionKey(metadata);
  if (!completedVersion || !incomingVersion || completedVersion === incomingVersion) return;
  job.completedIds = job.completedIds.filter((id) => id !== metadata.id);
  delete job.completedVersions[metadata.id];
  if (job.assets) job.assets.status = "pending";
}

function appendUniqueInPlace(target, values, seen = null) {
  const known = seen ?? new Set(target);
  for (const value of values) {
    if (!value || known.has(value)) continue;
    known.add(value);
    target.push(value);
  }
  return known;
}

function mergeConversationMetadata(job, incoming, context = {}, state = null) {
  const positions = state?.conversationPositions ?? new Map(job.conversations.map((item, index) => [item.id, index]));
  let added = 0;
  let refreshed = 0;
  for (const rawItem of incoming) {
    const item = normalizeMetadata(rawItem, context);
    if (!item) continue;
    const position = positions.get(item.id);
    if (position === undefined) {
      added += 1;
      positions.set(item.id, job.conversations.length);
      job.conversations.push(item);
      continue;
    }
    const existing = job.conversations[position];
    const merged = {
      ...existing,
      ...item,
      title: item.title || existing.title,
      locations: mergeLocations(existing.locations, item.locations),
      raw: item.raw ?? existing.raw,
    };
    const wasCompleted = job.completedIds.includes(item.id);
    markChangedConversationForRefresh(job, merged);
    if (wasCompleted && !job.completedIds.includes(item.id)) refreshed += 1;
    job.conversations[position] = merged;
  }
  return { added, refreshed };
}

function mergeProjects(job, incoming, state = null) {
  const positions = state?.projectPositions ?? new Map(job.projects.map((item, index) => [item.id, index]));
  let added = 0;
  for (const project of incoming) {
    if (!project?.id) continue;
    const position = positions.get(project.id);
    const existing = position === undefined ? null : job.projects[position];
    if (!existing) added += 1;
    const pagination = existing?.pagination ?? cursorPagination("0");
    const merged = {
      ...(existing ?? {}),
      ...project,
      present: true,
      files: Array.isArray(project.files) ? project.files : existing?.files ?? [],
      conversationIds: Array.isArray(existing?.conversationIds) ? existing.conversationIds : [],
      pagination,
    };
    if (position === undefined) {
      positions.set(project.id, job.projects.length);
      job.projects.push(merged);
    } else {
      job.projects[position] = merged;
    }
  }
  return { added };
}

async function pauseIfRequested(job, store, control) {
  if (!control.paused && typeof control.shouldPause === "function" && control.shouldPause()) control.paused = true;
  if (!control.paused) return false;
  job.status = "paused";
  job.pauseReason = control.reason || "user";
  job.current = null;
  await store.saveJob(checkpoint(job));
  return true;
}

function retryHandler(job, onProgress, phase, extra = {}) {
  return (event) => {
    job.stats.retries += 1;
    onProgress?.({ type: "retry", phase, ...extra, ...event, job });
  };
}

function finalizeSourceMembership(job, sourceKey, seenIds) {
  const seen = new Set(seenIds ?? []);
  for (const metadata of job.conversations) {
    metadata.locations = (metadata.locations ?? []).map((location) => location.type === sourceKey
      ? { ...location, present: seen.has(metadata.id) }
      : location);
  }
}

function finalizeProjectMembership(job, project, seenIds) {
  const seen = new Set(seenIds ?? []);
  for (const metadata of job.conversations) {
    metadata.locations = (metadata.locations ?? []).map((location) => location.type === "project" && location.projectId === project.id
      ? { ...location, present: seen.has(metadata.id) }
      : location);
  }
}

async function indexOffsetSource({ job, sourceKey, transport, store, onProgress, control, state, persist }) {
  const source = job.sources[sourceKey];
  if (source.pagination.indexingComplete) return;
  source.status = "indexing";
  job.status = "indexing";
  await store.saveJob(checkpoint(job));

  const maxPages = 10_000;
  for (let page = 0; page < maxPages; page += 1) {
    if (await pauseIfRequested(job, store, control)) return;
    const { offset, limit } = source.pagination;
    job.current = { phase: "indexing", source: sourceKey, offset, title: null, id: null };
    onProgress?.({ type: "indexing", source: sourceKey, job });
    const response = await withRetry(
      () => transport.listConversations({ offset, limit, archived: sourceKey === "archived" }),
      { onRetry: retryHandler(job, onProgress, "indexing", { source: sourceKey }) },
    );
    const merged = mergeConversationMetadata(job, response.items ?? [], {
      sourceType: sourceKey,
      workspaceId: job.accountContext?.workspaceId ?? null,
    }, state);
    source.pagination.scanIds ??= [];
    const sourceSeen = state.sourceScanSets.get(sourceKey) ?? new Set(source.pagination.scanIds);
    state.sourceScanSets.set(sourceKey, appendUniqueInPlace(source.pagination.scanIds, (response.items ?? []).map((item) => item.id).filter(Boolean), sourceSeen));
    source.pagination.reportedTotal = Number.isFinite(response.total) ? response.total : source.pagination.reportedTotal;
    source.pagination.consecutiveEmptyPages = merged.added === 0
      ? source.pagination.consecutiveEmptyPages + 1
      : 0;
    source.pagination.offset += limit;
    const shortPage = (response.items ?? []).length < limit;
    const reachedTotal = Number.isFinite(source.pagination.reportedTotal) && source.pagination.scanIds.length >= source.pagination.reportedTotal;
    const noNewForThreePages = source.pagination.consecutiveEmptyPages >= 3;
    if (shortPage || reachedTotal || noNewForThreePages) {
      source.pagination.indexingComplete = true;
      source.status = "complete";
      finalizeSourceMembership(job, sourceKey, source.pagination.scanIds);
    }
    await persist(source.pagination.indexingComplete);
    onProgress?.({ type: "indexed-page", source: sourceKey, added: merged.added, refreshed: merged.refreshed, job });
    if (source.pagination.indexingComplete) return;
  }
  throw new Error(`${sourceKey} 历史索引超过安全页数，已停止，避免无限请求。`);
}

async function indexProjectCatalog({ job, transport, store, onProgress, control, state, persist }) {
  const source = job.sources.projects;
  if (source.pagination.indexingComplete) return;
  source.status = "indexing";
  job.status = "indexing";
  const seenCursors = new Set();

  for (let page = 0; page < 1_000; page += 1) {
    if (await pauseIfRequested(job, store, control)) return;
    const cursor = source.pagination.started ? source.pagination.nextCursor : null;
    const cursorKey = cursor ?? "__first__";
    if (seenCursors.has(cursorKey)) throw new Error("Projects 列表返回了重复游标，已停止以避免无限请求。");
    seenCursors.add(cursorKey);
    job.current = { phase: "project-indexing", source: "projects", projectId: null, title: null, cursor };
    onProgress?.({ type: "project-indexing", cursor, job });
    const response = await withRetry(
      () => transport.listProjects({ cursor }),
      { onRetry: retryHandler(job, onProgress, "project-indexing", { source: "projects" }) },
    );
    const merged = mergeProjects(job, response.items ?? [], state);
    source.pagination.scanIds ??= [];
    appendUniqueInPlace(source.pagination.scanIds, (response.items ?? []).map((project) => project.id).filter(Boolean), state.projectCatalogSeen);
    for (const project of response.items ?? []) {
      if (project.embeddedConversations?.length) {
        const result = mergeConversationMetadata(job, project.embeddedConversations, {
          sourceType: "project",
          projectId: project.id,
          projectTitle: project.title,
          workspaceId: project.workspaceId ?? job.accountContext?.workspaceId ?? null,
        }, state);
        const current = job.projects.find((item) => item.id === project.id);
        if (current) {
          const ids = project.embeddedConversations.map((item) => item.id).filter(Boolean);
          current.conversationIds ??= [];
          appendUniqueInPlace(current.conversationIds, ids, state.projectConversationSets.get(current.id) ?? state.projectConversationSets.set(current.id, new Set(current.conversationIds)).get(current.id));
          if (project.embeddedCursor !== undefined) {
            current.pagination.started = true;
            current.pagination.nextCursor = project.embeddedCursor;
            if (project.embeddedCursor === null) current.pagination.indexingComplete = true;
          }
        }
        onProgress?.({ type: "project-embedded", project, added: result.added, job });
      }
    }
    source.pagination.started = true;
    source.pagination.pages += 1;
    source.pagination.nextCursor = response.cursor;
    if (!response.cursor) {
      source.pagination.indexingComplete = true;
      source.status = "complete";
      const seenProjects = new Set(source.pagination.scanIds ?? []);
      for (const item of job.projects) item.present = seenProjects.has(item.id);
    }
    await persist(source.pagination.indexingComplete);
    onProgress?.({ type: "project-page", added: merged.added, job });
    if (source.pagination.indexingComplete) return;
  }
  throw new Error("Projects 列表索引超过安全页数，已停止。");
}

async function indexProjectConversations({ job, transport, store, onProgress, control, state, persist }) {
  for (const project of job.projects) {
    project.pagination ??= cursorPagination("0");
    if (project.pagination.indexingComplete) continue;
    const seenCursors = new Set();
    for (let page = 0; page < 10_000; page += 1) {
      if (await pauseIfRequested(job, store, control)) return;
      const cursor = project.pagination.started ? project.pagination.nextCursor : "0";
      if (cursor === null || cursor === "") {
        project.pagination.indexingComplete = true;
        finalizeProjectMembership(job, project, project.pagination.scanIds);
        break;
      }
      if (seenCursors.has(cursor)) throw new Error(`项目“${project.title}”返回了重复游标，已停止。`);
      seenCursors.add(cursor);
      job.current = {
        phase: "project-conversations",
        source: "project",
        projectId: project.id,
        title: project.title,
        cursor,
      };
      onProgress?.({ type: "project-conversation-indexing", project, cursor, job });
      const response = await withRetry(
        () => transport.listProjectConversations({ project, cursor }),
        { onRetry: retryHandler(job, onProgress, "project-conversations", { source: "project", project }) },
      );
      const merged = mergeConversationMetadata(job, response.items ?? [], {
        sourceType: "project",
        projectId: project.id,
        projectTitle: project.title,
        workspaceId: project.workspaceId ?? job.accountContext?.workspaceId ?? null,
      }, state);
      const ids = (response.items ?? []).map((item) => item.id).filter(Boolean);
      project.pagination.scanIds ??= [];
      project.conversationIds ??= [];
      const projectScan = state.projectScanSets.get(project.id) ?? new Set(project.pagination.scanIds);
      state.projectScanSets.set(project.id, appendUniqueInPlace(project.pagination.scanIds, ids, projectScan));
      const projectConversations = state.projectConversationSets.get(project.id) ?? new Set(project.conversationIds);
      state.projectConversationSets.set(project.id, appendUniqueInPlace(project.conversationIds, ids, projectConversations));
      project.pagination.started = true;
      project.pagination.pages += 1;
      project.pagination.nextCursor = response.cursor;
      if (!response.cursor) {
        project.pagination.indexingComplete = true;
        finalizeProjectMembership(job, project, project.pagination.scanIds);
      }
      await persist(project.pagination.indexingComplete);
      onProgress?.({ type: "project-conversation-page", project, added: merged.added, refreshed: merged.refreshed, job });
      if (project.pagination.indexingComplete) break;
    }
    if (!project.pagination.indexingComplete) {
      throw new Error(`项目“${project.title}”会话索引超过安全页数，已停止。`);
    }
  }
}

async function pruneAbsentConversations(job, store, onProgress) {
  const absentIds = job.conversations.filter((item) => !isConversationPresent(item)).map((item) => item.id);
  if (!absentIds.length) return 0;
  const absent = new Set(absentIds);
  job.completedIds = job.completedIds.filter((id) => !absent.has(id));
  job.failures = job.failures.filter((failure) => !absent.has(failure.id));
  for (const id of absentIds) {
    delete job.completedVersions[id];
    if (typeof store.deleteArtifact === "function") await store.deleteArtifact(job.id, id);
  }
  onProgress?.({ type: "conversations-pruned", count: absentIds.length, ids: absentIds, job });
  return absentIds.length;
}

export async function indexAllConversations({ job, transport, store, onProgress, control = {} }) {
  const state = {
    conversationPositions: new Map(job.conversations.map((item, index) => [item.id, index])),
    projectPositions: new Map(job.projects.map((item, index) => [item.id, index])),
    sourceScanSets: new Map(Object.entries(job.sources ?? {}).map(([key, source]) => [key, new Set(source?.pagination?.scanIds ?? [])])),
    projectCatalogSeen: new Set(job.sources?.projects?.pagination?.scanIds ?? []),
    projectScanSets: new Map(job.projects.map((project) => [project.id, new Set(project.pagination?.scanIds ?? [])])),
    projectConversationSets: new Map(job.projects.map((project) => [project.id, new Set(project.conversationIds ?? [])])),
  };
  const persist = checkpointWriter({ store, job, everyItems: 8, everyMs: 3_000 });
  await indexOffsetSource({ job, sourceKey: "regular", transport, store, onProgress, control, state, persist });
  if (job.status === "paused") return job;
  await indexOffsetSource({ job, sourceKey: "archived", transport, store, onProgress, control, state, persist });
  if (job.status === "paused") return job;
  await indexProjectCatalog({ job, transport, store, onProgress, control, state, persist });
  if (job.status === "paused") return job;
  await indexProjectConversations({ job, transport, store, onProgress, control, state, persist });
  if (job.status === "paused") return job;
  await pruneAbsentConversations(job, store, onProgress);
  job.current = null;
  await persist(true);
  return job;
}

export async function exportAllConversations({ job, transport, store, onProgress, control = {}, requestDelayMs = 250, maxConversationAttempts = 5 }) {
  job.status = "exporting";
  await store.saveJob(checkpoint(job));
  const completed = new Set(job.completedIds);
  const ordered = job.conversations.filter(isConversationPresent).sort((a, b) => Number(b.updateTime ?? 0) - Number(a.updateTime ?? 0));
  const persist = checkpointWriter({ store, job, everyItems: 100, everyMs: 5_000 });

  for (let index = 0; index < ordered.length; index += 1) {
    const metadata = ordered[index];
    if (completed.has(metadata.id)) continue;
    if (await pauseIfRequested(job, store, control)) return job;
    job.current = { phase: "exporting", id: metadata.id, title: metadata.title, source: metadata.locations?.[0]?.type ?? "regular", index: index + 1, total: ordered.length };
    onProgress?.({ type: "conversation-start", metadata, index: index + 1, total: ordered.length, job });
    try {
      const raw = await withRetry(
        () => transport.fetchConversation(metadata.id),
        {
          maxAttempts: maxConversationAttempts,
          shouldContinue: () => !control.paused,
          onRetry: retryHandler(job, onProgress, "exporting", { metadata }),
        },
      );
      const storage = await store.putArtifact(job.id, metadata.id, {
        conversationId: metadata.id,
        provider: metadata.provider ?? job.provider ?? "chatgpt",
        adapter: metadata.provider === "chatgpt" || !metadata.provider ? "history-page-fetch" : "provider-history-fetch",
        sourceUrl: metadata.url ?? null,
        title: metadata.title,
        metadata,
        raw,
        fetchedAt: new Date().toISOString(),
      });
      job.stats.incrementalObjectsInserted = Number(job.stats.incrementalObjectsInserted ?? 0) + Number(storage?.inserted ?? 0);
      job.stats.incrementalObjectsReused = Number(job.stats.incrementalObjectsReused ?? 0) + Number(storage?.reused ?? 0);
      job.stats.incrementalBytesWritten = Number(job.stats.incrementalBytesWritten ?? 0) + Number(storage?.insertedBytes ?? 0);
      job.stats.incrementalBytesReused = Number(job.stats.incrementalBytesReused ?? 0) + Number(storage?.reusedBytes ?? 0);
      job.stats.incrementalNodesReused = Number(job.stats.incrementalNodesReused ?? 0) + Number(storage?.reusedByKind?.["conversation-node"] ?? 0);
      job.stats.incrementalMappingChunksReused = Number(job.stats.incrementalMappingChunksReused ?? 0) + Number(storage?.reusedByKind?.["conversation-map-chunk"] ?? 0);
      completed.add(metadata.id);
      if (!job.completedIds.includes(metadata.id)) job.completedIds.push(metadata.id);
      job.completedVersions[metadata.id] = versionKey(metadata);
      removeFailure(job, metadata.id);
      job.stats.completed = completed.size;
      job.stats.failed = job.failures.length;
      onProgress?.({ type: "conversation-complete", metadata, index: index + 1, total: ordered.length, job });
    } catch (error) {
      if (control.paused) {
        job.status = "paused";
        job.current = null;
        await store.saveJob(checkpoint(job));
        onProgress?.({ type: "job-paused", phase: "exporting", job });
        return job;
      }
      upsertFailure(job, metadata, error);
      job.stats.failed = job.failures.length;
      onProgress?.({ type: "conversation-failed", metadata, error, index: index + 1, total: ordered.length, job });
      if (error?.status === 401 || error?.status === 403) {
        job.status = "paused";
        job.current = null;
        await store.saveJob(checkpoint(job));
        throw new Error("ChatGPT 登录状态已失效。请重新登录当前工作空间，然后点击继续备份。", { cause: error });
      }
    }
    await persist(false);
    if ((index + 1) % 10 === 0) await yieldToBrowser();
    if (requestDelayMs > 0) await wait(requestDelayMs);
  }

  await persist(true);
  job.current = null;
  job.completedAt = null;
  job.status = "asset_indexing";
  job.assets.status = "pending";
  job.archiveExport = { status: "idle", planId: null, totalVolumes: 0, completedVolumes: [], updatedAt: null };
  await store.saveJob(checkpoint(job));
  onProgress?.({ type: "conversation-phase-complete", job });
  return job;
}


async function listStoredArtifactIds(store, jobId) {
  if (typeof store.listArtifactIds === "function") return store.listArtifactIds(jobId);
  const artifacts = typeof store.listArtifacts === "function" ? await store.listArtifacts(jobId) : [];
  return artifacts.map((item) => item?.conversationId).filter(Boolean);
}

async function getStoredArtifact(store, jobId, conversationId) {
  if (typeof store.getArtifact === "function") return store.getArtifact(jobId, conversationId);
  const artifacts = typeof store.listArtifacts === "function" ? await store.listArtifacts(jobId) : [];
  return artifacts.find((item) => item?.conversationId === conversationId) ?? null;
}

async function listStoredAssetKeys(store, jobId) {
  if (typeof store.listAssetKeys === "function") return store.listAssetKeys(jobId);
  const assets = typeof store.listAssets === "function" ? await store.listAssets(jobId) : [];
  return assets.map((item) => item?.assetKey).filter(Boolean);
}

function removeAssetFailure(job, assetKey) {
  job.assets.failures = job.assets.failures.filter((failure) => failure.key !== assetKey);
}

function upsertAssetFailure(job, asset, error) {
  removeAssetFailure(job, asset.key);
  job.assets.failures.push({
    key: asset.key,
    fileId: asset.fileId ?? null,
    fileName: asset.fileName,
    kind: asset.kind,
    error: error instanceof Error ? error.message : String(error),
    status: error?.status ?? null,
    diagnostic: error?.diagnostic ? clone(error.diagnostic) : null,
    at: new Date().toISOString(),
  });
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function inventoryAllAssets({ job, store, onProgress, control = {} }) {
  job.status = "asset_indexing";
  job.current = { phase: "asset-indexing", title: "正在扫描附件引用", index: 0, total: 0 };
  onProgress?.({ type: "asset-indexing", job });
  const presentConversationIds = new Set(job.conversations.filter(isConversationPresent).map((item) => item.id));
  const artifactIds = (await listStoredArtifactIds(store, job.id)).filter((id) => presentConversationIds.has(id));
  const inventoryMap = new Map();
  const scannedIds = [];
  job.current.total = artifactIds.length;

  for (let index = 0; index < artifactIds.length; index += 1) {
    if (await pauseIfRequested(job, store, control)) {
      job.assets.status = "paused";
      return job;
    }
    const conversationId = artifactIds[index];
    const artifact = await getStoredArtifact(store, job.id, conversationId);
    if (!artifact) continue;
    mergeAssetInventoryInto(inventoryMap, collectConversationAssetReferences(artifact.raw, artifact.metadata));
    if (artifact.conversationId) scannedIds.push(artifact.conversationId);
    job.current.index = index + 1;
    if ((index + 1) % 10 === 0 || index + 1 === artifactIds.length) {
      onProgress?.({ type: "asset-indexing-progress", index: index + 1, total: artifactIds.length, discovered: inventoryMap.size, job });
      await yieldToBrowser();
    }
  }
  mergeAssetInventoryInto(inventoryMap, collectProjectAssetReferences(job.projects.filter((project) => project?.present !== false)));
  const inventory = assetInventoryFromMap(inventoryMap);
  job.assets.inventory = inventory;
  job.assets.scannedConversationIds = [...new Set(scannedIds)];
  job.assets.unsupportedKeys = inventory.filter((item) => !item.downloadable).map((item) => item.key);
  job.assets.totalBytes = inventory.reduce((total, item) => total + (Number(item.expectedBytes) || 0), 0);
  const validKeys = new Set(inventory.map((item) => item.key));
  const storedKeys = new Set(await listStoredAssetKeys(store, job.id));
  for (const key of storedKeys) {
    if (!validKeys.has(key) && typeof store.deleteAsset === "function") {
      await store.deleteAsset(job.id, key);
      storedKeys.delete(key);
    }
  }
  job.assets.completedKeys = (job.assets.completedKeys ?? []).filter((key) => validKeys.has(key) && storedKeys.has(key));
  job.assets.downloadedBytes = 0;
  for (const key of job.assets.completedKeys) {
    const stored = await store.getAsset(job.id, key);
    job.assets.downloadedBytes += Number(stored?.sizeBytes) || 0;
  }
  job.assets.failures = (job.assets.failures ?? []).filter((failure) => validKeys.has(failure.key) && !storedKeys.has(failure.key));
  job.assets.status = "ready";
  job.current = null;
  job.stats.assetsDiscovered = inventory.length;
  job.stats.assetsDownloaded = job.assets.completedKeys.length;
  job.stats.assetFailures = job.assets.failures.length;
  job.stats.unsupportedAssets = job.assets.unsupportedKeys.length;
  job.stats.assetBytes = job.assets.downloadedBytes;
  await store.saveJob(checkpoint(job));
  onProgress?.({ type: "asset-inventory-complete", discovered: inventory.length, unsupported: job.assets.unsupportedKeys.length, job });
  return job;
}


export async function finalizeReferenceOnlyBackup({ job, store, onProgress }) {
  job.current = null;
  job.assets.failures = [];
  job.stats.assetFailures = 0;
  job.assets.status = "inventory_only";
  job.completedAt = new Date().toISOString();
  job.status = job.failures.length > 0 ? "completed_with_errors" : "completed";
  job.archiveExport = { status: "ready", planId: null, totalVolumes: 0, completedVolumes: [], updatedAt: new Date().toISOString() };
  await store.saveJob(checkpoint(job));
  onProgress?.({ type: "job-complete", assetPolicy: "references-only", job });
  return job;
}

export async function downloadAllAssets({ job, transport, store, onProgress, control = {}, requestDelayMs = 150, maxAssetBytes = 64 * 1024 * 1024 }) {
  job.status = "asset_downloading";
  job.assets.status = "downloading";
  await store.saveJob(checkpoint(job));
  const completed = new Set(job.assets.completedKeys ?? []);
  const downloadable = (job.assets.inventory ?? []).filter((asset) => asset.downloadable);
  const persist = checkpointWriter({ store, job, everyItems: 10, everyMs: 4_000 });

  for (let index = 0; index < downloadable.length; index += 1) {
    const asset = downloadable[index];
    if (completed.has(asset.key)) continue;
    if (await pauseIfRequested(job, store, control)) return job;
    job.current = { phase: "asset-downloading", id: asset.key, title: asset.fileName, source: asset.kind, index: index + 1, total: downloadable.length };
    onProgress?.({ type: "asset-start", asset, index: index + 1, total: downloadable.length, job });
    try {
      const result = await withRetry(
        () => transport.downloadAsset(asset, { maxBytes: maxAssetBytes }),
        { onRetry: retryHandler(job, onProgress, "asset-downloading", { asset }) },
      );
      const bytes = result.bytes instanceof Uint8Array ? result.bytes : Uint8Array.from(result.bytes ?? []);
      const expectedBytes = result.expectedBytes ?? asset.expectedBytes ?? null;
      if (Number.isFinite(expectedBytes) && expectedBytes >= 0 && bytes.byteLength !== expectedBytes) {
        const error = new Error(`附件大小校验失败：预期 ${expectedBytes}，实际 ${bytes.byteLength}`);
        error.status = 422;
        throw error;
      }
      const stored = {
        assetKey: asset.key,
        fileId: asset.fileId,
        fileName: result.fileName || asset.fileName,
        mimeType: result.mimeType || asset.mimeType || "application/octet-stream",
        sizeBytes: bytes.byteLength,
        expectedBytes,
        sha256: await sha256Hex(bytes),
        archivePath: assetArchivePath({ ...asset, fileName: result.fileName || asset.fileName }),
        bytes,
        references: clone(asset.references ?? []),
        diagnostics: result.diagnostics ? clone(result.diagnostics) : null,
        downloadedAt: new Date().toISOString(),
      };
      await store.putAsset(job.id, asset.key, stored);
      completed.add(asset.key);
      if (!job.assets.completedKeys.includes(asset.key)) job.assets.completedKeys.push(asset.key);
      job.assets.downloadedBytes = (job.assets.downloadedBytes ?? 0) + bytes.byteLength;
      removeAssetFailure(job, asset.key);
      job.stats.assetsDownloaded = completed.size;
      job.stats.assetFailures = job.assets.failures.length;
      job.stats.assetBytes = job.assets.downloadedBytes;
      const { bytes: _bytes, ...storedSummary } = stored;
      onProgress?.({ type: "asset-complete", asset, stored: storedSummary, index: index + 1, total: downloadable.length, job });
    } catch (error) {
      upsertAssetFailure(job, asset, error);
      job.stats.assetFailures = job.assets.failures.length;
      onProgress?.({ type: "asset-failed", asset, error, index: index + 1, total: downloadable.length, job });
      if (error?.status === 401 || error?.status === 403) {
        const sessionValid = await transport.verifySession?.().catch(() => null);
        if (sessionValid === false) {
          job.status = "paused";
          job.assets.status = "paused";
          job.current = null;
          await store.saveJob(checkpoint(job));
          throw new Error("ChatGPT 登录状态已失效。请刷新或重新登录当前工作空间，然后点击继续备份。", { cause: error });
        }
        job.warnings ??= [];
        job.warnings.push(`附件“${asset.fileName || asset.key}”当前不可访问，已跳过；对话备份不受影响。`);
      }
    }
    await persist(false);
    await yieldToBrowser();
    if (requestDelayMs > 0) await wait(requestDelayMs);
  }

  await persist(true);
  job.current = null;
  job.assets.status = job.assets.failures.length > 0 || job.assets.unsupportedKeys.length > 0 ? "partial" : "complete";
  job.completedAt = new Date().toISOString();
  job.status = job.failures.length > 0 || job.assets.failures.length > 0 || job.assets.unsupportedKeys.length > 0
    ? "completed_with_errors"
    : "completed";
  job.archiveExport = { status: "ready", planId: null, totalVolumes: 0, completedVolumes: [], updatedAt: new Date().toISOString() };
  await store.saveJob(checkpoint(job));
  onProgress?.({ type: "job-complete", job });
  return job;
}

function resetForIncrementalRefresh(job) {
  job.sources.regular = { type: "regular", pagination: offsetPagination(), status: "pending" };
  job.sources.archived = { type: "archived", pagination: offsetPagination(), status: "pending" };
  job.sources.projects = { type: "projects", pagination: cursorPagination(null), status: "pending" };
  for (const project of job.projects) project.pagination = cursorPagination("0");
  job.status = "indexing";
  job.assets.status = "pending";
  job.assets.scannedConversationIds = [];
  job.completedAt = null;
  job.current = null;
  job.archiveExport = { status: "idle", planId: null, totalVolumes: 0, completedVolumes: [], updatedAt: null };
  job.stats.incrementalObjectsInserted = 0;
  job.stats.incrementalObjectsReused = 0;
  job.stats.incrementalBytesWritten = 0;
  job.stats.incrementalBytesReused = 0;
  job.stats.incrementalNodesReused = 0;
  job.stats.incrementalMappingChunksReused = 0;
  return checkpoint(job);
}

function accountKey(context) {
  return `${context?.provider ?? "chatgpt"}:${context?.workspaceId || context?.accountScopeId || "personal"}`;
}

function assertCompatibleAccount(job, context) {
  if (!job.accountContext) {
    job.accountContext = {
      provider: context?.provider ?? job.provider ?? "chatgpt",
      workspaceId: context?.workspaceId ?? context?.accountScopeId ?? null,
      workspaceLabel: context?.workspaceLabel ?? context?.accountScopeLabel ?? "个人空间",
    };
    return;
  }
  if (accountKey(job.accountContext) !== accountKey(context)) {
    throw new Error(`当前平台空间为“${context?.workspaceLabel ?? context?.accountScopeLabel ?? "未知空间"}”，与本地任务“${job.accountContext.workspaceLabel ?? "另一空间"}”不一致。为避免混入不同账号，请切回原空间或新建选择集。`);
  }
}

function allSourcesIndexed(job) {
  return Boolean(
    job.sources.regular.pagination.indexingComplete
    && job.sources.archived.pagination.indexingComplete
    && job.sources.projects.pagination.indexingComplete
    && job.projects.every((project) => project.pagination?.indexingComplete),
  );
}

export async function reconcileDurableProgress(job, store) {
  const artifactIds = new Set(await listStoredArtifactIds(store, job.id));
  const conversationIds = new Set(job.conversations.map((item) => item.id));
  job.completedIds = [...artifactIds].filter((id) => conversationIds.has(id));
  for (const id of job.completedIds) {
    if (!(id in job.completedVersions)) {
      const metadata = job.conversations.find((item) => item.id === id);
      job.completedVersions[id] = versionKey(metadata);
    }
  }
  for (const id of Object.keys(job.completedVersions)) {
    if (!artifactIds.has(id)) delete job.completedVersions[id];
  }
  const assetKeys = new Set(await listStoredAssetKeys(store, job.id));
  const validAssetKeys = new Set((job.assets?.inventory ?? []).map((item) => item.key));
  job.assets.completedKeys = [...assetKeys].filter((key) => validAssetKeys.size === 0 || validAssetKeys.has(key));
  let downloadedBytes = 0;
  if (typeof store.getAsset === "function") {
    for (const key of job.assets.completedKeys) {
      const storedAsset = await store.getAsset(job.id, key);
      downloadedBytes += Number(storedAsset?.sizeBytes ?? storedAsset?.bytes?.byteLength ?? 0) || 0;
    }
  }
  job.assets.downloadedBytes = downloadedBytes;
  job.stats.completed = job.completedIds.length;
  job.stats.failed = job.failures.length;
  job.stats.assetsDownloaded = job.assets.completedKeys.length;
  job.stats.assetBytes = downloadedBytes;
  return checkpoint(job);
}

export async function runSelectedConversationExport({
  selection,
  store,
  transport,
  onProgress,
  control = {},
  requestDelayMs = 150,
  assetPolicy = "references-only",
  maxAssetBytes = 64 * 1024 * 1024,
  maxConversationAttempts = 2,
}) {
  const normalizedSelection = selection?.items ? selection : createConversationSelectionSet(selection ?? {});
  const id = selectionJobId(normalizedSelection);
  let job = migrateHistoryJob(await store.getLatestJob(id));
  if (!job) job = createSelectedConversationJob(normalizedSelection, { id, assetPolicy });
  if (job.selection?.fingerprint !== normalizedSelection.fingerprint) {
    throw new Error("该选择集内容已经变化。请新建一次批量导出，避免旧进度与新选择混合。");
  }
  job = await reconcileDurableProgress(job, store);
  job.assetPolicy = assetPolicy;
  const context = await transport.getContext?.() ?? { provider: job.provider, workspaceId: job.accountContext?.workspaceId ?? null, workspaceLabel: job.accountContext?.workspaceLabel ?? "当前平台空间" };
  assertCompatibleAccount(job, { provider: job.provider, ...context });
  if (job.status === "paused") job.status = "exporting";
  if (job.status === "completed" || job.status === "completed_with_errors") return job;
  await store.saveJob(checkpoint(job));
  await exportAllConversations({ job, transport, store, onProgress, control, requestDelayMs, maxConversationAttempts });
  if (job.status === "paused") return job;
  await inventoryAllAssets({ job, store, onProgress, control });
  if (job.status === "paused") return job;
  if (assetPolicy === "references-only") return finalizeReferenceOnlyBackup({ job, store, onProgress });
  return downloadAllAssets({
    job,
    transport,
    store,
    onProgress,
    control,
    requestDelayMs: Math.min(requestDelayMs, 200),
    maxAssetBytes,
  });
}

export async function runUnifiedHistoryBackup({
  store,
  transport,
  onProgress,
  control = {},
  requestDelayMs = 250,
  assetPolicy = "references-only",
  maxAssetBytes = 64 * 1024 * 1024,
  refreshCompletedWithErrors = false,
}) {
  let job = migrateHistoryJob(await store.getLatestJob(DEFAULT_HISTORY_JOB_ID));
  if (!job) job = createHistoryJob(DEFAULT_HISTORY_JOB_ID);
  job = await reconcileDurableProgress(job, store);
  job.assetPolicy = assetPolicy;

  const context = await transport.getContext?.() ?? { workspaceId: null, workspaceLabel: "个人空间" };
  assertCompatibleAccount(job, context);

  if (job.version !== HISTORY_JOB_VERSION) throw new Error("无法迁移本地历史任务，请导出旧数据后清空进度。");
  if (job.status === "completed" || (job.status === "completed_with_errors" && refreshCompletedWithErrors)) resetForIncrementalRefresh(job);
  else if (job.status === "paused") {
    job.status = allSourcesIndexed(job) ? "exporting" : "indexing";
    job.pauseReason = null;
  }
  else if (job.status === "completed_with_errors" && !allSourcesIndexed(job)) job.status = "indexing";
  await store.saveJob(checkpoint(job));

  try {
    if (!allSourcesIndexed(job)) await indexAllConversations({ job, transport, store, onProgress, control });
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      job.status = "paused";
      job.current = null;
      await store.saveJob(checkpoint(job));
      throw new Error("ChatGPT 登录状态已失效。请重新登录当前工作空间，然后点击继续备份。", { cause: error });
    }
    throw error;
  }
  if (job.status === "paused") return job;
  await exportAllConversations({ job, transport, store, onProgress, control, requestDelayMs });
  if (job.status === "paused") return job;
  await inventoryAllAssets({ job, store, onProgress, control });
  if (job.status === "paused") return job;
  if (assetPolicy === "references-only") return finalizeReferenceOnlyBackup({ job, store, onProgress });
  return downloadAllAssets({
    job,
    transport,
    store,
    onProgress,
    control,
    requestDelayMs: Math.min(requestDelayMs, 200),
    maxAssetBytes,
  });
}

// Compatibility exports for Batch 1 callers and tests.
export const runRegularHistoryBackup = runUnifiedHistoryBackup;
export const indexRegularConversations = indexAllConversations;
export const exportRegularConversations = exportAllConversations;
