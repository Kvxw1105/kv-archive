(() => {
  const STORAGE_KEY = "kv-archive-theme-mode";
  const allowed = new Set(["system", "light", "dark"]);
  let mode = "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (allowed.has(stored)) mode = stored;
  } catch {}
  const prefersDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
  const resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
})();
