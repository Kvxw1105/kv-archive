export function buildAssetIntegrityReport(job, storedAssets = []) {
  const inventory = job?.assets?.inventory ?? [];
  const inventoryKeys = new Set(inventory.map((item) => item.key));
  const currentStoredAssets = storedAssets.filter((item) => inventoryKeys.has(item.assetKey ?? item.key));
  const storedByKey = new Map(currentStoredAssets.map((item) => [item.assetKey ?? item.key, item]));
  const failures = job?.assets?.failures ?? [];
  const unsupported = inventory.filter((item) => !item.downloadable);
  const missing = inventory.filter((item) => item.downloadable && !storedByKey.has(item.key));
  const sizeMismatches = [];
  let actualBytes = 0;
  let expectedBytes = 0;
  let duplicateReferences = 0;
  for (const asset of inventory) {
    if (Number.isFinite(asset.expectedBytes)) expectedBytes += asset.expectedBytes;
    duplicateReferences += Math.max(0, (asset.references?.length ?? 0) - 1);
    const stored = storedByKey.get(asset.key);
    if (!stored) continue;
    actualBytes += Number(stored.sizeBytes ?? stored.bytes?.byteLength ?? stored.bytes?.length ?? 0) || 0;
    if (Number.isFinite(asset.expectedBytes) && Number.isFinite(stored.sizeBytes) && asset.expectedBytes !== stored.sizeBytes) {
      sizeMismatches.push({ key: asset.key, expected: asset.expectedBytes, actual: stored.sizeBytes });
    }
  }
  const issues = [];
  if (failures.length) issues.push({ code: "ASSET_DOWNLOAD_FAILURES", severity: "error", count: failures.length });
  if (missing.length) issues.push({ code: "MISSING_DOWNLOADED_ASSETS", severity: "error", count: missing.length, keys: missing.map((item) => item.key) });
  if (unsupported.length) issues.push({ code: "UNSUPPORTED_ASSET_REFERENCES", severity: "warning", count: unsupported.length, keys: unsupported.map((item) => item.key) });
  if (sizeMismatches.length) issues.push({ code: "ASSET_SIZE_MISMATCH", severity: "error", count: sizeMismatches.length, items: sizeMismatches });
  const status = failures.length || missing.length || sizeMismatches.length || unsupported.length ? "PARTIAL" : "COMPLETE";
  return {
    status,
    discovered: inventory.length,
    downloadable: inventory.filter((item) => item.downloadable).length,
    downloaded: currentStoredAssets.length,
    failed: failures.length,
    unsupported: unsupported.length,
    duplicateReferences,
    expectedBytes,
    actualBytes,
    missingKeys: missing.map((item) => item.key),
    issues,
  };
}
