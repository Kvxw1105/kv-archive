export function hasMeaningfulDraft(value = {}) {
  return [value.title, value.body, value.tags, value.sourceUrl, value.newProjectTitle]
    .some((item) => String(item || "").trim().length > 0);
}

export function normalizeDraft(value = {}) {
  return {
    schemaVersion: 1,
    updatedAt: String(value.updatedAt || new Date().toISOString()),
    editingId: value.editingId ? String(value.editingId) : null,
    expectedRevision: Number.isFinite(Number(value.expectedRevision)) ? Number(value.expectedRevision) : null,
    projectId: value.projectId ? String(value.projectId) : null,
    projectTitle: value.projectTitle ? String(value.projectTitle) : "",
    newProjectTitle: value.newProjectTitle ? String(value.newProjectTitle) : "",
    kind: String(value.kind || "note"),
    title: String(value.title || ""),
    body: String(value.body || ""),
    tags: String(value.tags || ""),
    sourceUrl: String(value.sourceUrl || ""),
  };
}

export function createDraftStore({ storage, key }) {
  if (!storage || !key) throw new Error("Draft storage and key are required");
  return {
    load() {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const value = normalizeDraft(JSON.parse(raw));
        return hasMeaningfulDraft(value) ? value : null;
      } catch {
        return null;
      }
    },
    save(value) {
      const draft = normalizeDraft(value);
      if (!hasMeaningfulDraft(draft)) {
        storage.removeItem(key);
        return null;
      }
      storage.setItem(key, JSON.stringify(draft));
      return draft;
    },
    clear() {
      storage.removeItem(key);
    },
  };
}

export function createDebouncedWriter(write, delay = 300) {
  let timer = null;
  return {
    schedule(value) {
      clearTimeout(timer);
      timer = setTimeout(() => write(value), delay);
    },
    flush(value) {
      clearTimeout(timer);
      timer = null;
      return write(value);
    },
    cancel() {
      clearTimeout(timer);
      timer = null;
    },
  };
}
