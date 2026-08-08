const WORKSPACE_FILES = new Set([
  "backup.html",
  "basket.html",
  "library.html",
  "capture.html",
  "state.html",
  "memory.html",
  "knowledge.html",
]);

function safeUrl(value) {
  try { return new URL(value); }
  catch { return null; }
}

export function isWorkspaceTabUrl(url, runtimeBase) {
  const parsed = safeUrl(url);
  const base = safeUrl(runtimeBase);
  if (!parsed || !base || parsed.origin !== base.origin) return false;
  const file = parsed.pathname.split("/").filter(Boolean).at(-1) || "";
  return WORKSPACE_FILES.has(file);
}

export function pickWorkspaceTab(tabs, runtimeBase) {
  return [...(tabs || [])]
    .filter((tab) => Number.isInteger(tab?.id) && isWorkspaceTabUrl(tab.url, runtimeBase))
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0] || null;
}

export async function openWorkspacePage(chromeApi, file) {
  if (!WORKSPACE_FILES.has(file)) throw new Error(`Unsupported workspace page: ${file}`);
  const runtimeBase = chromeApi.runtime.getURL("");
  const targetUrl = chromeApi.runtime.getURL(file);
  const tabs = await chromeApi.tabs.query({ currentWindow: true });
  const existing = pickWorkspaceTab(tabs, runtimeBase);
  if (existing?.id) {
    await chromeApi.tabs.update(existing.id, { url: targetUrl, active: true });
    return { mode: "reused", tabId: existing.id, url: targetUrl };
  }
  const created = await chromeApi.tabs.create({ url: targetUrl });
  return { mode: "created", tabId: created?.id ?? null, url: targetUrl };
}
