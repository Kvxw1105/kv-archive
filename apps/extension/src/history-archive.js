import { normalizeProviderConversation } from "./provider-normalizers.js";
import { renderActivePathMarkdown, renderReadableHtml } from "./packages/renderers/src/index.js";
import { generateIntegrityReport } from "./packages/integrity/src/index.js";
import { buildAssetIntegrityReport } from "./asset-integrity.js";
import { createStoredZip, createStoredZipBlob } from "./zip.js";
import { safeExportName } from "./export-artifact.js";

const encoder = new TextEncoder();
const isoDate = (value) => {
  const date = value ? new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "unknown-date";
};
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
function safeSegment(value, fallback) { return safeExportName(String(value || fallback)).replaceAll(" ", "_") || fallback; }
function primaryLocation(metadata) {
  const locations = Array.isArray(metadata?.locations) ? metadata.locations : [];
  return locations.find((location) => (location.type === "project" || location.type === "collection") && location.present !== false)
    ?? locations.find((location) => location.type === "archived" && location.present !== false)
    ?? locations.find((location) => location.type === "regular" && location.present !== false)
    ?? locations.find((location) => (location.type === "project" || location.type === "collection"))
    ?? locations.find((location) => location.type === "archived")
    ?? locations.find((location) => location.type === "regular")
    ?? { type: "regular", projectId: null, projectTitle: null };
}
function sourceInfo(metadata) {
  const location = primaryLocation(metadata);
  if ((location.type === "project" || location.type === "collection")) return { type: "project", label: location.projectTitle || "未命名项目", root: `projects/${safeSegment(location.projectTitle, "unnamed-project")}_${String(location.projectId || "project").slice(0, 8)}` };
  if (location.type === "archived") return { type: "archived", label: "归档会话", root: "archived" };
  return { type: "regular", label: "普通会话", root: "regular" };
}
function folderFor(canonical, metadata) {
  const date = isoDate(canonical.createdAt ?? canonical.updatedAt);
  const shortId = canonical.conversationId.slice(0, 8);
  const source = sourceInfo(metadata);
  return `${source.root}/${date}_${safeSegment(canonical.title, "conversation")}_${shortId}`;
}
function sourceLabel(record) { return record.sourceType === "project" ? `项目 · ${record.sourceLabel}` : record.sourceLabel; }
function bytesOf(data) { return typeof data === "string" ? encoder.encode(data).length : data?.byteLength ?? data?.length ?? 0; }
function estimateEntries(entries) { return entries.reduce((total, entry) => total + bytesOf(entry.data) + encoder.encode(entry.name).length + 128, 0); }
function relativeRootPrefix(folder) { return "../".repeat(String(folder || "").split("/").filter(Boolean).length); }

function assetListHtml(assets, storedByKey, folder) {
  if (assets.length === 0) return "";
  const prefix = relativeRootPrefix(folder);
  const rows = assets.map((asset) => {
    const stored = storedByKey.get(asset.key);
    if (stored) return `<li><a href="${escapeHtml(prefix + stored.archivePath)}">${escapeHtml(stored.fileName || asset.fileName)}</a><span>${escapeHtml(asset.kind)} · ${(stored.sizeBytes / 1024).toFixed(1)} KB</span></li>`;
    return `<li class="missing"><strong>${escapeHtml(asset.fileName)}</strong><span>${asset.downloadable ? "下载失败或尚未完成" : "仅保留引用，当前无法自动下载"}</span></li>`;
  }).join("");
  return `<section class="contextvault-assets"><h2>附件与图片</h2><ul>${rows}</ul></section><style>.contextvault-assets{margin:34px 0;padding:20px;border:1px solid rgba(127,127,127,.35);border-radius:16px}.contextvault-assets h2{font-size:18px}.contextvault-assets ul{display:grid;gap:10px;padding-left:20px}.contextvault-assets li{display:grid}.contextvault-assets span{font-size:12px;opacity:.65}.contextvault-assets .missing{color:#a15f52}</style>`;
}
function appendAssetsToHtml(html, assets, storedByKey, folder) {
  const section = assetListHtml(assets, storedByKey, folder);
  if (!section) return html;
  if (html.includes("</main>")) return html.replace("</main>", `${section}</main>`);
  return html.replace("</body>", `${section}</body>`);
}
function appendAssetsToMarkdown(markdown, assets, storedByKey, folder) {
  if (assets.length === 0) return markdown;
  const prefix = relativeRootPrefix(folder);
  const rows = assets.map((asset) => {
    const stored = storedByKey.get(asset.key);
    return stored ? `- [${stored.fileName || asset.fileName}](${prefix}${stored.archivePath}) · ${asset.kind} · ${stored.sizeBytes} bytes` : `- ${asset.fileName} · ${asset.downloadable ? "下载失败或尚未完成" : "仅保留引用"}`;
  });
  return `${markdown.trim()}\n\n## 附件与图片\n\n${rows.join("\n")}\n`;
}

export function renderHistoryIndex(records, job, assetReport = null) {
  const rows = records.map((record) => `<a class="item" data-source="${escapeHtml(record.sourceType)}" data-project="${escapeHtml(record.projectId ?? "")}" href="${escapeHtml(record.path)}/conversation.html"><div class="copy"><strong>${escapeHtml(record.title)}</strong><span>${escapeHtml(record.date)} · ${escapeHtml(sourceLabel(record))} · 附件 ${record.assetCount ?? 0}</span></div><em data-status="${escapeHtml(record.status)}">${record.status === "COMPLETE" ? "完整" : "需检查"}</em></a>`).join("\n");
  const failures = job.failures.length > 0 ? `<section class="fail"><h2>未完成 ${job.failures.length} 条</h2><ul>${job.failures.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.error)}</span></li>`).join("")}</ul></section>` : "";
  const assetFailures = (job.assets?.failures?.length ?? 0) > 0 || (job.assets?.unsupportedKeys?.length ?? 0) > 0 ? `<section class="fail"><h2>附件需检查 ${(job.assets?.failures?.length ?? 0) + (job.assets?.unsupportedKeys?.length ?? 0)} 项</h2><p>详情见 asset-integrity-report.json。</p></section>` : "";
  const projectOptions = (job.projects ?? []).map((project) => `<option value="project:${escapeHtml(project.id)}">项目 · ${escapeHtml(project.title)}</option>`).join("");
  const workspace = job.accountContext?.workspaceLabel || "个人空间";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KV Archive AI 对话备份</title><style>:root{color-scheme:light dark;--bg:#f4f2ed;--card:#fff;--text:#171717;--muted:#77736b;--line:#ddd9d0;--accent:#315b4c;--shadow:0 14px 44px rgba(53,47,38,.08)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}.shell{max-width:980px;margin:auto;padding:42px 20px 80px}.eyebrow{font-size:11px;letter-spacing:.18em;color:var(--muted)}h1{font-size:clamp(30px,6vw,52px);margin:10px 0 4px}.meta{color:var(--muted);margin-bottom:20px}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:22px 0}.metric{padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:var(--shadow)}.metric span{display:block;color:var(--muted);font-size:12px}.metric strong{font-size:26px}.metric small{font-size:12px}.toolbar{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr 220px;gap:10px;padding:12px 0;background:linear-gradient(var(--bg) 75%,transparent)}input,select{width:100%;padding:13px 15px;border:1px solid var(--line);border-radius:13px;background:var(--card);color:var(--text);font:inherit}.list{display:grid;gap:10px}.item{display:flex;align-items:center;justify-content:space-between;gap:16px;text-decoration:none;color:inherit;padding:16px 18px;border:1px solid var(--line);background:var(--card);border-radius:15px;box-shadow:var(--shadow)}.item:hover{border-color:var(--accent);transform:translateY(-1px)}.copy{display:grid}.item span{color:var(--muted);font-size:12px}.item em{font-style:normal;color:var(--muted);font-size:12px}.item em[data-status="COMPLETE"]{color:var(--accent)}.hidden{display:none}.fail{margin-top:30px;padding:18px;border:1px solid #9b6c61;border-radius:14px}.fail h2{font-size:16px;margin-top:0}.fail li{display:grid;margin:8px 0}.fail span,.fail p{color:var(--muted)}@media(max-width:800px){.metrics{grid-template-columns:repeat(3,1fr)}}@media(max-width:680px){.metrics{grid-template-columns:repeat(2,1fr)}.toolbar{grid-template-columns:1fr}.shell{padding:28px 14px 60px}}@media(prefers-color-scheme:dark){:root{--bg:#111210;--card:#1a1c19;--text:#efeee9;--muted:#aaa79f;--line:#333630;--accent:#91c7af;--shadow:none}}</style></head><body><main class="shell"><div class="eyebrow">KV ARCHIVE · 对话备份</div><h1>AI 对话资产</h1><div class="meta">${escapeHtml(workspace)} · 成功保存 ${records.length} 条 · 失败 ${job.failures.length} 条 · ${escapeHtml(job.completedAt ?? job.updatedAt)}</div><section class="metrics"><div class="metric"><span>普通会话</span><strong>${job.stats?.regular ?? 0}</strong></div><div class="metric"><span>归档会话</span><strong>${job.stats?.archived ?? 0}</strong></div><div class="metric"><span>项目与空间</span><strong>${job.stats?.projects ?? 0}</strong></div><div class="metric"><span>项目会话</span><strong>${job.stats?.projectConversations ?? 0}</strong></div><div class="metric"><span>附件已保存</span><strong>${assetReport?.downloaded ?? 0}</strong></div><div class="metric"><span>附件大小</span><strong>${((assetReport?.actualBytes ?? 0)/1024/1024).toFixed(1)}<small> MB</small></strong></div></section><div class="toolbar"><input id="q" type="search" placeholder="搜索对话标题或项目…"><select id="scope"><option value="all">全部来源</option><option value="regular">普通会话</option><option value="archived">归档会话</option><option value="project">所有项目与空间</option>${projectOptions}</select></div><section class="list">${rows}</section>${failures}${assetFailures}</main><script>const q=document.getElementById('q');const scope=document.getElementById('scope');const rows=[...document.querySelectorAll('.item')];function filter(){const v=q.value.trim().toLowerCase();const s=scope.value;for(const row of rows){const source=row.dataset.source;const project=row.dataset.project;const sourceMatch=s==='all'||s===source||(s.startsWith('project:')&&source==='project'&&project===s.slice(8));const textMatch=!v||row.textContent.toLowerCase().includes(v);row.classList.toggle('hidden',!(sourceMatch&&textMatch));}}q.addEventListener('input',filter);scope.addEventListener('change',filter);</script></body></html>`;
}

function buildContent({ artifacts, assets, job }) {
  const inventory = job.assets?.inventory ?? [];
  const inventoryKeys = new Set(inventory.map((asset) => asset.key));
  const currentAssets = assets.filter((asset) => inventoryKeys.has(asset.assetKey));
  const metadataById = new Map((job.conversations ?? []).map((item) => [item.id, item]));
  const storedByKey = new Map(currentAssets.map((item) => [item.assetKey, item]));
  const sorted = [...artifacts].sort((a, b) => Number((metadataById.get(b.conversationId) ?? b.metadata)?.updateTime ?? b.raw?.update_time ?? 0) - Number((metadataById.get(a.conversationId) ?? a.metadata)?.updateTime ?? a.raw?.update_time ?? 0) || String(a.title).localeCompare(String(b.title)));
  const bundles = [];
  const records = [];
  for (const artifact of sorted) {
    const metadata = metadataById.get(artifact.conversationId) ?? artifact.metadata ?? {};
    const provider = artifact.provider ?? metadata?.provider ?? "chatgpt";
  const canonical = normalizeProviderConversation(artifact.raw, {
    provider,
    adapter: artifact.adapter ?? "history-page-fetch",
    sourceUrl: artifact.sourceUrl ?? metadata?.url ?? (provider === "chatgpt" ? `https://chatgpt.com/c/${artifact.conversationId}` : null),
    primaryCollectionId: metadata?.primaryCollectionId ?? metadata?.projectId ?? null,
    collectionRefs: metadata?.collectionRefs ?? [],
  });
    const report = generateIntegrityReport(canonical);
    const folder = folderFor(canonical, metadata);
    const relatedAssets = inventory.filter((asset) => asset.conversationIds?.includes(canonical.conversationId));
    const markdown = appendAssetsToMarkdown(renderActivePathMarkdown(canonical), relatedAssets, storedByKey, folder);
    const html = appendAssetsToHtml(renderReadableHtml(canonical, { integrityStatus: report.status }), relatedAssets, storedByKey, folder);
    const source = sourceInfo(metadata);
    const entries = [
      { name: `${folder}/conversation.html`, data: html },
      { name: `${folder}/conversation.md`, data: markdown },
      { name: `${folder}/raw.json`, data: JSON.stringify(artifact.raw, null, 2) + "\n" },
      { name: `${folder}/canonical.json`, data: JSON.stringify(canonical, null, 2) + "\n" },
      { name: `${folder}/integrity-report.json`, data: JSON.stringify(report, null, 2) + "\n" },
      { name: `${folder}/source-metadata.json`, data: JSON.stringify(metadata, null, 2) + "\n" },
      { name: `${folder}/asset-manifest.json`, data: JSON.stringify(relatedAssets.map((asset) => ({ ...asset, stored: storedByKey.has(asset.key), archivePath: storedByKey.get(asset.key)?.archivePath ?? null })), null, 2) + "\n" },
    ];
    bundles.push({ id: `conversation:${canonical.conversationId}`, type: "conversation", entries, estimatedBytes: estimateEntries(entries) });
    records.push({ id: canonical.conversationId, title: canonical.title, date: isoDate(canonical.updatedAt ?? canonical.createdAt), path: folder, status: report.status, sourceType: source.type, sourceLabel: source.label, projectId: primaryLocation(metadata).projectId ?? null, locations: metadata.locations ?? [], assetCount: relatedAssets.length });
  }
  for (const asset of currentAssets) {
    const entries = [{ name: asset.archivePath, data: asset.bytes }];
    bundles.push({ id: `asset:${asset.assetKey}`, type: "asset", entries, estimatedBytes: estimateEntries(entries) });
  }
  for (const project of job.projects ?? []) {
    const projectAssets = inventory.filter((asset) => asset.projectIds?.includes(project.id));
    if (!projectAssets.length) continue;
    const root = `projects/${safeSegment(project.title, "unnamed-project")}_${String(project.id || "project").slice(0, 8)}`;
    const entries = [{ name: `${root}/project-assets.json`, data: JSON.stringify(projectAssets.map((asset) => ({ ...asset, stored: storedByKey.has(asset.key), archivePath: storedByKey.get(asset.key)?.archivePath ?? null })), null, 2) + "\n" }];
    bundles.push({ id: `project-assets:${project.id}`, type: "project-assets", entries, estimatedBytes: estimateEntries(entries) });
  }
  const assetReport = buildAssetIntegrityReport(job, currentAssets);
  return { bundles, records, assetReport, currentAssets };
}

function partitionBundles(bundles, maxVolumeBytes, reserve = 1024 * 1024) {
  const volumes = [{ bundles: [], estimatedBytes: reserve }];
  for (const bundle of bundles) {
    let current = volumes[volumes.length - 1];
    if (current.bundles.length > 0 && current.estimatedBytes + bundle.estimatedBytes > maxVolumeBytes) {
      current = { bundles: [], estimatedBytes: 0 };
      volumes.push(current);
    }
    current.bundles.push(bundle);
    current.estimatedBytes += bundle.estimatedBytes;
  }
  return volumes;
}


function jsonForScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function renderLowMemoryHistoryIndexShell(job, assetReport = null) {
  const workspace = job.accountContext?.workspaceLabel || "个人空间";
  const projectOptions = (job.projects ?? []).filter((project) => project.present !== false).map((project) => `<option value="project:${escapeHtml(project.id)}">项目 · ${escapeHtml(project.title)}</option>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KV Archive AI 对话备份</title><style>:root{color-scheme:light dark;--bg:#f4f2ed;--card:#fff;--text:#171717;--muted:#77736b;--line:#ddd9d0;--accent:#315b4c}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}.shell{max-width:980px;margin:auto;padding:42px 20px 80px}.eyebrow{font-size:11px;letter-spacing:.18em;color:var(--muted)}h1{font-size:clamp(30px,6vw,52px);margin:10px 0 4px}.meta,.result-meta{color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:22px 0}.metric,.item{padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--card)}.metric span,.item span{display:block;color:var(--muted);font-size:12px}.metric strong{font-size:26px}.toolbar{position:sticky;top:0;display:grid;grid-template-columns:1fr 220px;gap:10px;padding:12px 0;background:var(--bg)}input,select,button{width:100%;padding:13px 15px;border:1px solid var(--line);border-radius:13px;background:var(--card);color:var(--text);font:inherit}.list{display:grid;gap:10px;margin-top:14px}.item{display:flex;align-items:center;justify-content:space-between;gap:16px;text-decoration:none;color:inherit}.item em{font-style:normal;color:var(--accent);font-size:12px}.more{margin-top:14px}.empty{padding:30px;text-align:center;color:var(--muted)}@media(max-width:800px){.metrics{grid-template-columns:repeat(3,1fr)}}@media(max-width:680px){.metrics{grid-template-columns:repeat(2,1fr)}.toolbar{grid-template-columns:1fr}}@media(prefers-color-scheme:dark){:root{--bg:#111210;--card:#1a1c19;--text:#efeee9;--muted:#aaa79f;--line:#333630;--accent:#91c7af}}</style></head><body><main class="shell"><div class="eyebrow">KV ARCHIVE · 低内存对话备份</div><h1>AI 对话资产</h1><div class="meta">${escapeHtml(workspace)} · 附件 ${(assetReport?.downloaded ?? 0)} 个 · ${((assetReport?.actualBytes ?? 0)/1024/1024).toFixed(1)} MB</div><section class="metrics"><div class="metric"><span>普通会话</span><strong>${job.stats?.regular ?? 0}</strong></div><div class="metric"><span>归档会话</span><strong>${job.stats?.archived ?? 0}</strong></div><div class="metric"><span>项目与空间</span><strong>${job.stats?.projects ?? 0}</strong></div><div class="metric"><span>项目会话</span><strong>${job.stats?.projectConversations ?? 0}</strong></div><div class="metric"><span>已保存</span><strong>${job.stats?.completed ?? 0}</strong></div><div class="metric"><span>失败</span><strong>${job.stats?.failed ?? 0}</strong></div></section><div class="toolbar"><input id="q" type="search" placeholder="搜索对话标题或项目…"><select id="scope"><option value="all">全部来源</option><option value="regular">普通会话</option><option value="archived">归档会话</option><option value="project">所有项目与空间</option>${projectOptions}</select></div><div id="result-meta" class="result-meta"></div><section id="list" class="list"></section><button id="more" class="more" type="button">加载更多</button></main><script src="index-data.js"></script><script>(()=>{const all=Array.isArray(window.__CONTEXTVAULT_INDEX__)?window.__CONTEXTVAULT_INDEX__:[];const q=document.getElementById('q'),scope=document.getElementById('scope'),list=document.getElementById('list'),more=document.getElementById('more'),meta=document.getElementById('result-meta');let shown=0,filtered=[];const BATCH=150;function match(r){const term=q.value.trim().toLowerCase();const s=scope.value;const sourceOk=s==='all'||r.sourceType===s||(s==='project'&&r.sourceType==='project')||(s.startsWith('project:')&&r.projectId===s.slice(8));return sourceOk&&(!term||String(r.title+' '+r.sourceLabel).toLowerCase().includes(term))}function item(r){const a=document.createElement('a');a.className='item';a.href=r.path+'/conversation.html';const c=document.createElement('div'),strong=document.createElement('strong'),span=document.createElement('span'),em=document.createElement('em');strong.textContent=r.title;span.textContent=r.date+' · '+(r.sourceType==='project'?'项目 · '+r.sourceLabel:r.sourceLabel)+' · 附件 '+(r.assetCount||0);em.textContent=r.status==='COMPLETE'?'完整':'需检查';c.append(strong,span);a.append(c,em);return a}function reset(){filtered=all.filter(match);shown=0;list.textContent='';append()}function append(){const next=filtered.slice(shown,shown+BATCH);if(!next.length&&shown===0){const e=document.createElement('div');e.className='empty';e.textContent='没有匹配的对话';list.append(e)}else next.forEach(r=>list.append(item(r)));shown+=next.length;meta.textContent='显示 '+Math.min(shown,filtered.length)+' / '+filtered.length+' 条';more.hidden=shown>=filtered.length}q.addEventListener('input',reset);scope.addEventListener('change',reset);more.addEventListener('click',append);reset()})();</script></body></html>`;
}

export function buildHistoryArchiveVolumes({ artifacts, assets = [], job, generatedAt = new Date(), maxVolumeBytes = 380 * 1024 * 1024 }) {
  const { bundles, records, assetReport, currentAssets } = buildContent({ artifacts, assets, job });
  const partitioned = partitionBundles(bundles, maxVolumeBytes);
  const volumeCount = partitioned.length;
  const baseName = `KV-Archive-AI-Conversation-Backup-${generatedAt.toISOString().slice(0, 10)}`;
  const assignments = [];
  partitioned.forEach((volume, index) => { for (const bundle of volume.bundles) assignments.push({ id: bundle.id, type: bundle.type, volume: index + 1 }); });
  const counts = { uniqueConversations: job.conversations.length, exported: records.length, failed: job.failures.length, regular: job.stats?.regular ?? 0, archived: job.stats?.archived ?? 0, projects: job.stats?.projects ?? (job.projects?.length ?? 0), projectConversations: job.stats?.projectConversations ?? 0, assetsDiscovered: assetReport.discovered, assetsDownloaded: assetReport.downloaded, assetFailures: assetReport.failed, unsupportedAssets: assetReport.unsupported, assetBytes: assetReport.actualBytes };
  const manifest = {
    format: "kv-archive-conversation-backup", version: 3, generatedAt: generatedAt.toISOString(), scope: job.scope, accountContext: job.accountContext, counts, volumeCount,
    volumeExtraction: volumeCount > 1 ? "Extract every volume into the same directory before opening index.html." : "Open index.html after extraction.", assignments,
    projects: (job.projects ?? []).map((project) => ({ id: project.id, title: project.title, description: project.description, workspaceId: project.workspaceId, conversationCount: project.conversationIds?.length ?? 0, fileCount: project.files?.length ?? 0, present: project.present !== false })),
    conversations: records,
    assets: (job.assets?.inventory ?? []).map((asset) => ({ ...asset, stored: currentAssets.some((item) => item.assetKey === asset.key), archivePath: currentAssets.find((item) => item.assetKey === asset.key)?.archivePath ?? null })),
    failures: job.failures, assetFailures: job.assets?.failures ?? [], warnings: job.warnings ?? [],
  };
  const rootEntries = [
    { name: "README.txt", data: `KV Archive AI 对话备份包\n\n1. ${volumeCount > 1 ? "把所有分卷 ZIP 解压到同一个目录。" : "解压本 ZIP。"}\n2. 双击 index.html 查看普通、归档与 项目与空间 对话。\n3. 附件与图片只在 assets/ 目录保存一份，多个会话共享同一文件。\n4. asset-integrity-report.json 记录缺失、暂不支持和下载失败的文件。\n` },
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) + "\n" },
    { name: "asset-integrity-report.json", data: JSON.stringify(assetReport, null, 2) + "\n" },
    { name: "projects.json", data: JSON.stringify(manifest.projects, null, 2) + "\n" },
    { name: "index.html", data: renderHistoryIndex(records, job, assetReport) },
  ];
  const volumes = partitioned.map((volume, index) => {
    const number = index + 1;
    const entries = [{ name: "VOLUME.txt", data: `KV Archive volume ${number} of ${volumeCount}. Extract all volumes into the same directory.\n` }, ...(index === 0 ? rootEntries : []), ...volume.bundles.flatMap((bundle) => bundle.entries)];
    const filename = volumeCount === 1 ? `${baseName}.zip` : `${baseName}.part-${String(number).padStart(3, "0")}-of-${String(volumeCount).padStart(3, "0")}.zip`;
    return { number, filename, bytes: createStoredZip(entries, generatedAt), entryCount: entries.length, estimatedBytes: estimateEntries(entries) };
  });
  return { volumes, manifest, assetReport, estimatedBytes: volumes.reduce((total, volume) => total + volume.estimatedBytes, 0) };
}

export function buildHistoryArchive(options) {
  const result = buildHistoryArchiveVolumes({ ...options, maxVolumeBytes: Number.MAX_SAFE_INTEGER });
  const volume = result.volumes[0];
  return { filename: volume.filename, bytes: volume.bytes, manifest: result.manifest, assetReport: result.assetReport, estimatedBytes: result.estimatedBytes };
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

function roughObjectBytes(value, visited = new Set(), depth = 0) {
  if (value === null || value === undefined) return 4;
  if (typeof value === "string") return value.length * 2 + 8;
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (typeof value !== "object" || depth > 40 || visited.has(value)) return 0;
  visited.add(value);
  let total = Array.isArray(value) ? 16 : 32;
  if (Array.isArray(value)) {
    for (const item of value) total += roughObjectBytes(item, visited, depth + 1);
  } else {
    for (const [key, item] of Object.entries(value)) total += key.length * 2 + roughObjectBytes(item, visited, depth + 1);
  }
  return total;
}

function fnv1a(parts) {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part ?? "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

function recordFromMetadata(metadata, inventoryByConversation, failures) {
  const source = sourceInfo(metadata);
  const canonicalStub = {
    conversationId: metadata.id,
    title: metadata.title || "Untitled conversation",
    createdAt: metadata.createTime ?? null,
    updatedAt: metadata.updateTime ?? metadata.createTime ?? null,
  };
  const folder = folderFor(canonicalStub, metadata);
  return {
    id: metadata.id,
    title: canonicalStub.title,
    date: isoDate(canonicalStub.updatedAt ?? canonicalStub.createdAt),
    path: folder,
    status: failures.has(metadata.id) ? "PARTIAL" : "COMPLETE",
    sourceType: source.type,
    sourceLabel: source.label,
    projectId: primaryLocation(metadata).projectId ?? null,
    locations: metadata.locations ?? [],
    assetCount: inventoryByConversation.get(metadata.id)?.length ?? 0,
  };
}

function partitionDescriptors(descriptors, maxVolumeBytes, firstVolumeReserve) {
  const volumes = [{ descriptors: [], estimatedBytes: firstVolumeReserve }];
  for (const descriptor of descriptors) {
    let volume = volumes[volumes.length - 1];
    if (volume.descriptors.length > 0 && volume.estimatedBytes + descriptor.estimatedBytes > maxVolumeBytes) {
      volume = { descriptors: [], estimatedBytes: 0 };
      volumes.push(volume);
    }
    volume.descriptors.push(descriptor);
    volume.estimatedBytes += descriptor.estimatedBytes;
  }
  return volumes;
}

function createArchiveManifest({ job, records, assetReport, storedByKey, volumeCount, assignments, generatedAt }) {
  const counts = {
    uniqueConversations: job.conversations.length,
    exported: records.length,
    failed: job.failures.length,
    regular: job.stats?.regular ?? 0,
    archived: job.stats?.archived ?? 0,
    projects: job.stats?.projects ?? (job.projects?.length ?? 0),
    projectConversations: job.stats?.projectConversations ?? 0,
    assetsDiscovered: assetReport.discovered,
    assetsDownloaded: assetReport.downloaded,
    assetFailures: assetReport.failed,
    unsupportedAssets: assetReport.unsupported,
    assetBytes: assetReport.actualBytes,
  };
  return {
    format: "kv-archive-conversation-backup",
    version: 4,
    generatedAt: generatedAt.toISOString(),
    scope: job.scope,
    accountContext: job.accountContext,
    counts,
    volumeCount,
    volumeExtraction: volumeCount > 1 ? "Extract every volume into the same directory before opening index.html." : "Open index.html after extraction.",
    conversationIndex: "conversation-index.json",
    assetIndex: "asset-integrity-report.json",
    volumeMap: "volume-map.json",
    projects: (job.projects ?? []).map((project) => ({ id: project.id, title: project.title, description: project.description, workspaceId: project.workspaceId, conversationCount: project.conversationIds?.length ?? 0, fileCount: project.files?.length ?? 0, present: project.present !== false })),
    failures: job.failures,
    assetFailures: job.assets?.failures ?? [],
    warnings: job.warnings ?? [],
    captureProgress: job.captureProgress ?? null,
  };
}

function rootArchiveEntries({ plan, job }) {
  return [
    { name: "README.txt", data: `KV Archive AI 对话备份包\n\n1. ${plan.volumeCount > 1 ? "把所有分卷 ZIP 解压到同一个目录。" : "解压本 ZIP。"}\n2. 双击 index.html 查看普通、归档与 项目与空间 对话。\n3. 附件与图片只在 assets/ 目录保存一份，多个会话共享同一文件。\n4. asset-integrity-report.json 记录缺失、暂不支持和下载失败的文件。\n5. 本备份由低内存分卷管线生成；若中途关闭，可在扩展中继续剩余分卷。\n` },
    { name: "manifest.json", data: JSON.stringify(plan.manifest, null, 2) + "\n" },
    { name: "conversation-index.json", data: JSON.stringify(plan.records, null, 2) + "\n" },
    { name: "volume-map.json", data: JSON.stringify(plan.assignments, null, 2) + "\n" },
    { name: "asset-integrity-report.json", data: JSON.stringify(plan.assetReport, null, 2) + "\n" },
    { name: "projects.json", data: JSON.stringify(plan.manifest.projects, null, 2) + "\n" },
    { name: "index-data.js", data: `window.__CONTEXTVAULT_INDEX__=${jsonForScript(plan.records)};\n` },
    { name: "index.html", data: renderLowMemoryHistoryIndexShell(job, plan.assetReport) },
  ];
}

function conversationEntries({ artifact, metadata, relatedAssets, storedByKey }) {
  const provider = artifact.provider ?? metadata?.provider ?? "chatgpt";
  const canonical = normalizeProviderConversation(artifact.raw, {
    provider,
    adapter: artifact.adapter ?? "history-page-fetch",
    sourceUrl: artifact.sourceUrl ?? metadata?.url ?? (provider === "chatgpt" ? `https://chatgpt.com/c/${artifact.conversationId}` : null),
    primaryCollectionId: metadata?.primaryCollectionId ?? metadata?.projectId ?? null,
    collectionRefs: metadata?.collectionRefs ?? [],
  });
  const report = generateIntegrityReport(canonical);
  const folder = folderFor(canonical, metadata);
  const markdown = appendAssetsToMarkdown(renderActivePathMarkdown(canonical), relatedAssets, storedByKey, folder);
  const html = appendAssetsToHtml(renderReadableHtml(canonical, { integrityStatus: report.status }), relatedAssets, storedByKey, folder);
  return [
    { name: `${folder}/conversation.html`, data: html },
    { name: `${folder}/conversation.md`, data: markdown },
    { name: `${folder}/raw.json`, data: JSON.stringify(artifact.raw, null, 2) + "\n" },
    { name: `${folder}/canonical.json`, data: JSON.stringify(canonical, null, 2) + "\n" },
    { name: `${folder}/integrity-report.json`, data: JSON.stringify(report, null, 2) + "\n" },
    { name: `${folder}/source-metadata.json`, data: JSON.stringify(metadata, null, 2) + "\n" },
    { name: `${folder}/asset-manifest.json`, data: JSON.stringify(relatedAssets.map((asset) => ({ ...asset, stored: storedByKey.has(asset.key), archivePath: storedByKey.get(asset.key)?.archivePath ?? null })), null, 2) + "\n" },
  ];
}

/**
 * Creates a compact archive plan without retaining raw artifacts or binary
 * assets. Artifact records are loaded one at a time only to estimate a safe
 * volume boundary.
 */
export async function createLowMemoryHistoryArchivePlan({
  store,
  job,
  generatedAt = new Date(),
  maxVolumeBytes = 48 * 1024 * 1024,
  onProgress,
}) {
  const artifactIds = await store.listArtifactIds(job.id);
  const validArtifacts = new Set(artifactIds);
  const storedMetadata = await store.listAssetMetadata(job.id);
  const inventoryKeys = new Set((job.assets?.inventory ?? []).map((item) => item.key));
  const currentAssets = storedMetadata.filter((item) => inventoryKeys.has(item.assetKey));
  const storedByKey = new Map(currentAssets.map((item) => [item.assetKey, item]));
  const inventoryByConversation = new Map();
  const inventoryByProject = new Map();
  for (const asset of job.assets?.inventory ?? []) {
    for (const conversationId of asset.conversationIds ?? []) {
      const list = inventoryByConversation.get(conversationId) ?? [];
      list.push(asset);
      inventoryByConversation.set(conversationId, list);
    }
    for (const projectId of asset.projectIds ?? []) {
      const list = inventoryByProject.get(projectId) ?? [];
      list.push(asset);
      inventoryByProject.set(projectId, list);
    }
  }
  const failures = new Set((job.failures ?? []).map((item) => item.id));
  const records = (job.conversations ?? [])
    .filter((metadata) => validArtifacts.has(metadata.id))
    .sort((a, b) => Number(b.updateTime ?? 0) - Number(a.updateTime ?? 0) || String(a.title).localeCompare(String(b.title)))
    .map((metadata) => recordFromMetadata(metadata, inventoryByConversation, failures));
  const metadataById = new Map((job.conversations ?? []).map((item) => [item.id, item]));
  const descriptors = [];

  for (let index = 0; index < artifactIds.length; index += 1) {
    const conversationId = artifactIds[index];
    const artifact = await store.getArtifact(job.id, conversationId);
    if (!artifact) continue;
    const roughBytes = roughObjectBytes(artifact.raw);
    descriptors.push({
      id: `conversation:${conversationId}`,
      type: "conversation",
      conversationId,
      estimatedBytes: Math.max(192 * 1024, Math.ceil(roughBytes * 3.2 + 96 * 1024)),
    });
    if ((index + 1) % 10 === 0 || index + 1 === artifactIds.length) {
      onProgress?.({ phase: "planning-conversations", index: index + 1, total: artifactIds.length, title: metadataById.get(conversationId)?.title ?? artifact.title });
      await nextTask();
    }
  }

  for (const asset of currentAssets) {
    descriptors.push({ id: `asset:${asset.assetKey}`, type: "asset", assetKey: asset.assetKey, estimatedBytes: Number(asset.sizeBytes) || 0 });
  }
  for (const project of job.projects ?? []) {
    const count = inventoryByProject.get(project.id)?.length ?? 0;
    if (count) descriptors.push({ id: `project-assets:${project.id}`, type: "project-assets", projectId: project.id, estimatedBytes: 64 * 1024 + count * 512 });
  }

  const rootReserve = Math.max(2 * 1024 * 1024, records.length * 900 + (job.assets?.inventory?.length ?? 0) * 800 + 512 * 1024);
  const partitioned = partitionDescriptors(descriptors, Math.max(8 * 1024 * 1024, maxVolumeBytes), rootReserve);
  const assignments = [];
  partitioned.forEach((volume, index) => volume.descriptors.forEach((descriptor) => assignments.push({ id: descriptor.id, type: descriptor.type, volume: index + 1 })));
  const assetReport = buildAssetIntegrityReport(job, currentAssets);
  const manifest = createArchiveManifest({ job, records, assetReport, storedByKey, volumeCount: partitioned.length, assignments, generatedAt });
  function* signatureParts() {
    yield job.id;
    yield job.completedAt;
    yield artifactIds.length;
    yield currentAssets.length;
    yield assetReport.actualBytes;
    yield* artifactIds;
    for (const item of currentAssets) yield item.assetKey;
  }
  const planId = `archive-${fnv1a(signatureParts())}`;
  const partialSuffix = job.captureProgress?.isPartial
    ? `-Partial-${job.captureProgress.savedCount}-of-${job.captureProgress.selectedTotal}`
    : "";
  const baseName = `KV-Archive-AI-Conversation-Backup-${generatedAt.toISOString().slice(0, 10)}${partialSuffix}`;
  return {
    id: planId,
    generatedAt,
    baseName,
    volumeCount: partitioned.length,
    volumes: partitioned.map((volume, index) => ({ number: index + 1, estimatedBytes: volume.estimatedBytes, descriptors: volume.descriptors })),
    records,
    manifest,
    assetReport,
    assignments,
    storedByKey,
    inventoryByConversation,
    inventoryByProject,
  };
}

/** Builds exactly one volume and returns a Blob. No other volume bytes live. */
export async function buildLowMemoryHistoryArchiveVolume({ plan, volumeNumber, store, job, onProgress }) {
  const volume = plan.volumes.find((item) => item.number === volumeNumber);
  if (!volume) throw new Error(`Archive volume does not exist: ${volumeNumber}`);
  const entries = [
    { name: "VOLUME.txt", data: `KV Archive volume ${volumeNumber} of ${plan.volumeCount}. Extract all volumes into the same directory.\n` },
    ...(volumeNumber === 1 ? rootArchiveEntries({ plan, job }) : []),
  ];
  const metadataById = new Map((job.conversations ?? []).map((item) => [item.id, item]));

  for (let index = 0; index < volume.descriptors.length; index += 1) {
    const descriptor = volume.descriptors[index];
    if (descriptor.type === "conversation") {
      const artifact = await store.getArtifact(job.id, descriptor.conversationId);
      if (!artifact) throw new Error(`Conversation artifact is missing: ${descriptor.conversationId}`);
      const metadata = metadataById.get(descriptor.conversationId) ?? artifact.metadata ?? {};
      entries.push(...conversationEntries({ artifact, metadata, relatedAssets: plan.inventoryByConversation.get(descriptor.conversationId) ?? [], storedByKey: plan.storedByKey }));
      onProgress?.({ phase: "building-volume", volume: volumeNumber, totalVolumes: plan.volumeCount, index: index + 1, total: volume.descriptors.length, title: metadata.title ?? artifact.title });
    } else if (descriptor.type === "asset") {
      const asset = await store.getAsset(job.id, descriptor.assetKey);
      if (!asset?.bytes) throw new Error(`Stored asset is missing: ${descriptor.assetKey}`);
      entries.push({ name: asset.archivePath, data: asset.bytes });
      onProgress?.({ phase: "building-volume", volume: volumeNumber, totalVolumes: plan.volumeCount, index: index + 1, total: volume.descriptors.length, title: asset.fileName });
    } else if (descriptor.type === "project-assets") {
      const project = (job.projects ?? []).find((item) => item.id === descriptor.projectId);
      if (project) {
        const projectAssets = plan.inventoryByProject.get(project.id) ?? [];
        const root = `projects/${safeSegment(project.title, "unnamed-project")}_${String(project.id || "project").slice(0, 8)}`;
        entries.push({ name: `${root}/project-assets.json`, data: JSON.stringify(projectAssets.map((asset) => ({ ...asset, stored: plan.storedByKey.has(asset.key), archivePath: plan.storedByKey.get(asset.key)?.archivePath ?? null })), null, 2) + "\n" });
      }
    }
    if ((index + 1) % 4 === 0) await nextTask();
  }

  const filename = plan.volumeCount === 1
    ? `${plan.baseName}.zip`
    : `${plan.baseName}.part-${String(volumeNumber).padStart(3, "0")}-of-${String(plan.volumeCount).padStart(3, "0")}.zip`;
  const blob = createStoredZipBlob(entries, plan.generatedAt);
  return { number: volumeNumber, filename, blob, sizeBytes: blob.size, entryCount: entries.length, estimatedBytes: volume.estimatedBytes };
}
