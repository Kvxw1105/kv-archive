const KIND_LABELS = Object.freeze({
  note: "笔记",
  flash: "闪念",
  web_excerpt: "网页摘录",
  ai_excerpt: "AI 片段",
  conversation: "对话",
  image: "图片",
  file: "文件",
});

export { KIND_LABELS };

export function slugifyProject(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const slug = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || `project-${Date.now()}`;
}

export function parseTags(value) {
  return [...new Set(String(value ?? "")
    .split(/[,，\n#]+/)
    .map((tag) => tag.trim())
    .filter(Boolean))]
    .slice(0, 50);
}

export function buildCaptureInput(form, now = new Date().toISOString()) {
  const body = String(form.body ?? "").trim();
  if (!body) throw new Error("先写一点内容再保存。");
  const kind = String(form.kind || "flash");
  const projectTitle = String(form.projectTitle ?? "").trim() || null;
  const title = String(form.title ?? "").trim()
    || (kind === "flash" ? body.replace(/\s+/g, " ").slice(0, 42) : "未命名记录");
  return {
    kind,
    projectId: projectTitle ? slugifyProject(projectTitle) : null,
    projectTitle,
    title,
    body,
    bodyFormat: "markdown",
    tags: parseTags(form.tags),
    source: {
      provider: form.sourceUrl ? "web" : "mobile",
      sourceId: null,
      sourceUrl: String(form.sourceUrl ?? "").trim() || null,
      rawObjectKey: null,
      capturedAt: now,
      metadata: { captureSurface: "notes-pwa" },
    },
    metadata: { captureSurface: "notes-pwa" },
  };
}

export function collectProjects(items) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.projectId) continue;
    const current = map.get(item.projectId);
    const title = item.projectTitle || item.projectId;
    const updatedAt = item.updatedAt || item.createdAt || "";
    if (!current || updatedAt > current.updatedAt) map.set(item.projectId, { id: item.projectId, title, updatedAt });
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}

export function filterTimeline(items, filters = {}) {
  const query = String(filters.query ?? "").trim().toLowerCase();
  return [...(items || [])]
    .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
    .filter((item) => !filters.kind || filters.kind === "all" || item.kind === filters.kind)
    .filter((item) => {
      if (!filters.projectId || filters.projectId === "all") return true;
      if (filters.projectId === "unbound") return !item.projectId;
      return item.projectId === filters.projectId;
    })
    .filter((item) => {
      if (!query) return true;
      return `${item.title}\n${item.body}\n${(item.tags || []).join(" ")}\n${item.projectTitle || ""}`.toLowerCase().includes(query);
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")) || String(a.id).localeCompare(String(b.id)));
}

export function dayKey(value, locale = "zh-CN") {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return "未知日期";
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const delta = Math.round((start.getTime() - target.getTime()) / 86400000);
  if (delta === 0) return "今天";
  if (delta === 1) return "昨天";
  if (delta > 1 && delta < 7) return `${delta} 天前`;
  return new Intl.DateTimeFormat(locale, { year: date.getFullYear() === today.getFullYear() ? undefined : "numeric", month: "long", day: "numeric" }).format(date);
}

export function groupTimeline(items) {
  const groups = [];
  for (const item of items || []) {
    const key = dayKey(item.updatedAt || item.createdAt);
    let group = groups.at(-1);
    if (!group || group.label !== key) {
      group = { label: key, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function relativeTime(value, now = Date.now()) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

export function previewText(value, max = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
