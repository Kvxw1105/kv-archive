const text = (value) => typeof value === "string" ? value.trim() : "";

function safeDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function extensionOf(filename) {
  const value = text(filename);
  const match = value.match(/(\.[a-z0-9]{1,12})$/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function aliasFactory(prefix) {
  const aliases = new Map();
  return (value) => {
    const key = text(value) || "unknown";
    if (!aliases.has(key)) aliases.set(key, `${prefix}-${String(aliases.size + 1).padStart(3, "0")}`);
    return aliases.get(key);
  };
}

export function sanitizeDiagnosticText(value) {
  return text(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer <redacted>")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname.replace(/file[-_][a-z0-9]+/gi, "<file-id>")}`;
      } catch {
        return "<redacted-url>";
      }
    })
    .replace(/file[-_][a-z0-9]+/gi, "<file-id>")
    .replace(/g-p-[a-f0-9]{16,}/gi, "<project-id>")
    .replace(/ws-[a-z0-9-]+/gi, "<workspace-id>")
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "<uuid>")
    .slice(0, 500);
}

export function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return sanitizeDiagnosticText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (typeof value !== "object") return String(value);
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/token|authorization|cookie|downloadurl|signedurl|sourceurl/i.test(key)) continue;
    output[key] = sanitizeDiagnosticValue(child, depth + 1);
  }
  return output;
}

export function classifyAcceptanceFailure(status, message) {
  const code = Number(status);
  const value = sanitizeDiagnosticText(message).toLowerCase();
  if (code === 401 || code === 403 || /登录|auth|token|permission|权限/.test(value)) return "AUTH";
  if (code === 404) return "ENDPOINT_OR_FILE_NOT_FOUND";
  if (code === 413 || /上限|too large|超过/.test(value)) return "FILE_TOO_LARGE";
  if (code === 429 || /rate|频率|限流/.test(value)) return "RATE_LIMIT";
  if (code >= 500) return "UPSTREAM_SERVER";
  if (code === 422 || /校验|不完整|解析/.test(value)) return "INTEGRITY_OR_SHAPE";
  if (/sandbox/.test(value)) return "SANDBOX_REFERENCE_ONLY";
  return "OTHER";
}

export function buildAcceptanceDiagnostic({ job, assets = [], extensionVersion = "unknown", generatedAt = new Date() }) {
  const conversationAlias = aliasFactory("conversation");
  const assetAlias = aliasFactory("asset");
  const projectAlias = aliasFactory("project");
  const inventory = job?.assets?.inventory ?? [];
  const currentKeys = new Set(inventory.map((item) => item.key));
  const stored = assets.filter((item) => currentKeys.has(item.assetKey ?? item.key));
  const storedByKey = new Map(stored.map((item) => [item.assetKey ?? item.key, item]));
  const failures = job?.assets?.failures ?? [];
  const failureByKey = new Map(failures.map((item) => [item.key, item]));

  const assetRows = inventory.map((item) => {
    const saved = storedByKey.get(item.key);
    const failure = failureByKey.get(item.key);
    return {
      id: assetAlias(item.key),
      kind: text(item.kind) || "unknown",
      extension: extensionOf(saved?.fileName ?? item.fileName),
      mimeType: text(saved?.mimeType ?? item.mimeType) || null,
      downloadable: Boolean(item.downloadable),
      state: saved ? "saved" : failure ? "failed" : item.downloadable ? "missing" : "unsupported",
      expectedBytes: Number.isFinite(Number(item.expectedBytes)) ? Number(item.expectedBytes) : null,
      actualBytes: Number.isFinite(Number(saved?.sizeBytes)) ? Number(saved.sizeBytes) : null,
      referenceCount: item.references?.length ?? 0,
      conversationRefs: [...new Set(item.conversationIds ?? [])].map(conversationAlias),
      projectRefs: [...new Set(item.projectIds ?? [])].map(projectAlias),
      sha256Present: Boolean(saved?.sha256),
      transport: saved?.diagnostics ? sanitizeDiagnosticValue(saved.diagnostics) : null,
      failure: failure ? {
        category: classifyAcceptanceFailure(failure.status, failure.error),
        status: failure.status ?? null,
        message: sanitizeDiagnosticText(failure.error),
        diagnostic: failure.diagnostic ? sanitizeDiagnosticValue(failure.diagnostic) : null,
      } : null,
    };
  });

  const conversationFailures = (job?.failures ?? []).map((failure) => ({
    id: conversationAlias(failure.id),
    status: failure.status ?? null,
    category: classifyAcceptanceFailure(failure.status, failure.error),
    message: sanitizeDiagnosticText(failure.error),
  }));

  const categories = {};
  for (const row of assetRows) {
    if (!row.failure) continue;
    categories[row.failure.category] = (categories[row.failure.category] ?? 0) + 1;
  }
  for (const failure of conversationFailures) categories[failure.category] = (categories[failure.category] ?? 0) + 1;

  const observedKinds = [...new Set(assetRows.map((item) => item.kind))].sort();
  const recommendedKinds = ["user-image", "attachment", "dalle-image", "code-output", "project-file"];
  const missingRecommendedKinds = recommendedKinds.filter((kind) => !observedKinds.includes(kind));
  const actualBytes = stored.reduce((sum, item) => sum + (Number(item.sizeBytes) || 0), 0);
  const expectedBytes = inventory.reduce((sum, item) => sum + (Number(item.expectedBytes) || 0), 0);
  const unsupported = assetRows.filter((item) => item.state === "unsupported").length;
  const missing = assetRows.filter((item) => item.state === "missing").length;
  const failed = assetRows.filter((item) => item.state === "failed").length;
  const saved = assetRows.filter((item) => item.state === "saved").length;

  return {
    format: "context-vault-real-account-acceptance-diagnostic",
    version: 1,
    generatedAt: safeDate(generatedAt),
    extensionVersion,
    privacy: {
      rawConversationContentIncluded: false,
      accessTokensIncluded: false,
      signedDownloadUrlsIncluded: false,
      originalTitlesIncluded: false,
      originalFilenamesIncluded: false,
      identifiersAliased: true,
    },
    account: {
      mode: job?.accountContext?.workspaceId ? "workspace" : "personal",
      workspaceLabelPresent: Boolean(job?.accountContext?.workspaceLabel),
    },
    job: {
      status: job?.status ?? "missing",
      version: job?.version ?? null,
      startedAt: job?.createdAt ?? null,
      updatedAt: job?.updatedAt ?? null,
      completedAt: job?.completedAt ?? null,
      retries: job?.stats?.retries ?? 0,
    },
    conversations: {
      discovered: job?.conversations?.length ?? 0,
      saved: job?.completedIds?.length ?? 0,
      failed: conversationFailures.length,
      regular: job?.stats?.regular ?? 0,
      archived: job?.stats?.archived ?? 0,
      projects: job?.stats?.projects ?? 0,
      projectConversations: job?.stats?.projectConversations ?? 0,
      failures: conversationFailures,
    },
    coverage: {
      observedKinds,
      recommendedKinds,
      missingRecommendedKinds,
      note: "Missing recommended kinds are unexercised coverage, not automatic failures.",
    },
    assets: {
      discovered: inventory.length,
      downloadable: inventory.filter((item) => item.downloadable).length,
      saved,
      failed,
      missing,
      unsupported,
      expectedBytes,
      actualBytes,
      duplicateReferences: inventory.reduce((sum, item) => sum + Math.max(0, (item.references?.length ?? 0) - 1), 0),
      failureCategories: categories,
      items: assetRows,
    },
    gate: {
      passed: conversationFailures.length === 0 && failed === 0 && missing === 0 && unsupported === 0,
      blockers: [
        ...(conversationFailures.length ? [`${conversationFailures.length} conversation failures`] : []),
        ...(failed ? [`${failed} asset download failures`] : []),
        ...(missing ? [`${missing} downloadable assets missing`] : []),
        ...(unsupported ? [`${unsupported} unsupported asset references`] : []),
      ],
    },
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function renderAcceptanceDiagnosticHtml(report) {
  const rows = report.assets.items.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.extension || "—")}</td><td>${escapeHtml(item.state)}</td><td>${item.expectedBytes ?? "—"}</td><td>${item.actualBytes ?? "—"}</td><td>${escapeHtml(item.failure?.category ?? "—")}</td></tr>`).join("");
  const blockers = report.gate.blockers.length ? `<ul>${report.gate.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>未发现阻塞项。</p>";
  const coverage = report.coverage.missingRecommendedKinds.length
    ? `<p><strong>尚未覆盖的建议类型：</strong>${report.coverage.missingRecommendedKinds.map(escapeHtml).join("、")}</p>`
    : "<p><strong>建议附件类型均已出现。</strong></p>";
  const embedded = JSON.stringify(report).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KV Archive 真实账号验收诊断</title><style>:root{color-scheme:light dark;--bg:#f3f1eb;--card:#fff;--text:#171717;--muted:#706d66;--line:#dcd7cc;--good:#2e6b4f;--bad:#9b4949}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}.shell{max-width:1080px;margin:auto;padding:38px 18px 80px}.eyebrow{font-size:11px;letter-spacing:.16em;color:var(--muted)}h1{font-size:clamp(30px,6vw,52px);margin:8px 0}.lead{color:var(--muted);max-width:760px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}.metric span{display:block;color:var(--muted);font-size:12px}.metric strong{font-size:28px}.gate{border-color:${report.gate.passed ? "var(--good)" : "var(--bad)"}}table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}th,td{padding:10px;text-align:left;border-bottom:1px solid var(--line);font-size:12px}th{color:var(--muted)}button{margin-top:14px;border:0;border-radius:10px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}.table-wrap{overflow:auto}}@media(prefers-color-scheme:dark){:root{--bg:#111210;--card:#1a1c19;--text:#efeee9;--muted:#aaa79f;--line:#333630;--good:#8fc7aa;--bad:#e29797}}</style></head><body><main class="shell"><div class="eyebrow">KV ARCHIVE · ACCEPTANCE DIAGNOSTIC</div><h1>真实账号附件验收</h1><p class="lead">此报告已经脱敏，不包含对话正文、访问令牌、签名下载地址、原始标题或原始文件名。可以直接上传给开发者定位兼容性问题。</p><section class="grid"><div class="card metric"><span>对话保存</span><strong>${report.conversations.saved}</strong></div><div class="card metric"><span>附件发现</span><strong>${report.assets.discovered}</strong></div><div class="card metric"><span>附件保存</span><strong>${report.assets.saved}</strong></div><div class="card metric"><span>附件异常</span><strong>${report.assets.failed + report.assets.missing + report.assets.unsupported}</strong></div></section><section class="card gate"><h2>${report.gate.passed ? "验收门槛通过" : "仍有待修复项"}</h2>${blockers}${coverage}<p>扩展版本：${escapeHtml(report.extensionVersion)} · 生成时间：${escapeHtml(report.generatedAt)}</p><button id="json">下载同内容 JSON</button></section><h2>附件逐项结果</h2><div class="table-wrap"><table><thead><tr><th>别名</th><th>类型</th><th>扩展名</th><th>状态</th><th>预计字节</th><th>实际字节</th><th>失败分类</th></tr></thead><tbody>${rows || '<tr><td colspan="7">没有发现附件。</td></tr>'}</tbody></table></div></main><script>const report=${embedded};document.getElementById('json').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(report,null,2)+'\\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='KV-Archive-Acceptance-Diagnostic.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);});</script></body></html>`;
}
