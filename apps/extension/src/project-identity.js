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

export function resolveProjectSelection({ selectedId = null, selectedTitle = "", newTitle = "", existingProjects = [] } = {}) {
  const createdTitle = String(newTitle || "").trim();
  if (createdTitle) {
    const id = slugifyProject(createdTitle);
    const existing = existingProjects.find((project) => String(project?.id || "") === id);
    if (existing) {
      const existingTitle = String(existing.title || existing.id).trim();
      if (existingTitle.normalize("NFKC").toLocaleLowerCase() !== createdTitle.normalize("NFKC").toLocaleLowerCase()) {
        throw new Error(`Project 名称“${createdTitle}”与现有“${existingTitle}”产生相同标识，请换一个更具体的名称。`);
      }
      return { id, title: existingTitle, created: false };
    }
    return { id, title: createdTitle, created: true };
  }
  const id = String(selectedId || "").trim() || null;
  return { id, title: id ? String(selectedTitle || id).trim() || id : null, created: false };
}
