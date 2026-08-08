function ratio(done, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(1, done / total));
}

function indexingFraction(job) {
  const sources = job?.sources ?? {};
  const regular = sources.regular?.pagination ?? {};
  const archived = sources.archived?.pagination ?? {};
  const projects = sources.projects?.pagination ?? {};
  const regularPart = regular.indexingComplete ? 1 : ratio(regular.scanIds?.length ?? 0, regular.reportedTotal ?? 0);
  const archivedPart = archived.indexingComplete ? 1 : ratio(archived.scanIds?.length ?? 0, archived.reportedTotal ?? 0);
  const projectCatalogPart = projects.indexingComplete ? 1 : Math.min(0.9, (projects.pages ?? 0) * 0.25);
  const projectList = job?.projects ?? [];
  const finishedProjects = projectList.filter((project) => project.pagination?.indexingComplete).length;
  const projectConversationPart = projectList.length === 0
    ? (projects.indexingComplete ? 1 : 0)
    : ratio(finishedProjects, projectList.length);
  return (regularPart + archivedPart + projectCatalogPart + projectConversationPart) / 4;
}

export function computeBackupProgress(job, archiveProgress = null) {
  if (archiveProgress?.totalVolumes) {
    const completedVolumes = Number(archiveProgress.completed ?? 0);
    const currentFraction = archiveProgress.phase === "building" && archiveProgress.total
      ? ratio(Number(archiveProgress.index ?? 0), Number(archiveProgress.total))
      : 0;
    return Math.min(100, Math.round(((completedVolumes + currentFraction) / archiveProgress.totalVolumes) * 100));
  }
  if (!job) return 0;
  const stats = job.stats ?? {};
  if (job.status === "indexing") return Math.max(1, Math.min(15, Math.round(indexingFraction(job) * 15)));
  const conversationTotal = Number(stats.indexed ?? job.conversations?.length ?? 0);
  const conversationDone = Number(stats.completed ?? job.completedIds?.length ?? 0) + Number(stats.failed ?? job.failures?.length ?? 0);
  if (job.status === "exporting") return 15 + Math.round(ratio(conversationDone, conversationTotal) * 55);
  if (job.status === "asset_indexing") {
    const current = job.current ?? {};
    return 70 + Math.round(ratio(Number(current.index ?? 0), Number(current.total ?? 0)) * 5);
  }
  const assetDownloadable = Math.max(0, Number(stats.assetsDiscovered ?? 0) - Number(stats.unsupportedAssets ?? 0));
  const assetDone = Number(stats.assetsDownloaded ?? 0) + Number(stats.assetFailures ?? 0);
  if (job.status === "asset_downloading") return 75 + Math.round(ratio(assetDone, assetDownloadable) * 24);
  if (job.status === "completed" || job.status === "completed_with_errors") return 100;
  if (job.status === "paused") {
    if (assetDownloadable > 0) return 75 + Math.round(ratio(assetDone, assetDownloadable) * 24);
    if (conversationTotal > 0) return 15 + Math.round(ratio(conversationDone, conversationTotal) * 55);
    return Math.max(1, Math.round(indexingFraction(job) * 15));
  }
  return 0;
}
