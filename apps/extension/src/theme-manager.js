const STORAGE_KEY = "kv-archive-theme-mode";
const MODES = Object.freeze(["system", "light", "dark"]);
const LABELS = Object.freeze({ system: "跟随系统", light: "浅色", dark: "深色" });
const SHORT_LABELS = Object.freeze({ system: "自动", light: "浅色", dark: "深色" });
const ICONS = Object.freeze({ system: "◐", light: "☀", dark: "◑" });
const THEME_COLORS = Object.freeze({ light: "#f3f0e8", dark: "#0b0c0b" });
const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)") ?? null;

export function normalizeThemeMode(value) {
  return MODES.includes(value) ? value : "system";
}

export function resolveTheme(mode, prefersDark = media?.matches === true) {
  const normalized = normalizeThemeMode(mode);
  return normalized === "system" ? (prefersDark ? "dark" : "light") : normalized;
}

export function readThemeMode() {
  try { return normalizeThemeMode(localStorage.getItem(STORAGE_KEY)); }
  catch { return "system"; }
}

function updateThemeMeta(resolved) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = THEME_COLORS[resolved];
}

function syncControls(mode, resolved) {
  for (const control of document.querySelectorAll("[data-theme-control]")) {
    control.dataset.mode = mode;
    control.dataset.resolvedTheme = resolved;
    for (const button of control.querySelectorAll("[data-theme-option]")) {
      const active = button.dataset.themeOption === mode;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    }
  }
  for (const cycle of document.querySelectorAll("[data-theme-cycle]")) {
    cycle.dataset.mode = mode;
    cycle.dataset.resolvedTheme = resolved;
    cycle.setAttribute("aria-label", `当前外观：${LABELS[mode]}。点击切换。`);
    cycle.title = `外观：${LABELS[mode]}（当前${resolved === "dark" ? "深色" : "浅色"}）`;
    const label = cycle.querySelector("[data-theme-cycle-label]");
    const icon = cycle.querySelector("[data-theme-cycle-icon]");
    if (label) label.textContent = SHORT_LABELS[mode];
    if (icon) icon.textContent = ICONS[mode];
  }
}

export function applyTheme(mode, { persist = false, announce = true } = {}) {
  const normalized = normalizeThemeMode(mode);
  const resolved = resolveTheme(normalized);
  const root = document.documentElement;
  root.dataset.themeMode = normalized;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  updateThemeMeta(resolved);
  syncControls(normalized, resolved);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, normalized); } catch {}
  }
  if (announce) {
    window.dispatchEvent(new CustomEvent("kv-theme-change", { detail: { mode: normalized, resolved } }));
  }
  return { mode: normalized, resolved };
}

function themeButtons() {
  return MODES.map((mode) => `<button type="button" class="theme-option" data-theme-option="${mode}" aria-pressed="false" title="${LABELS[mode]}"><span aria-hidden="true">${ICONS[mode]}</span><span>${SHORT_LABELS[mode]}</span></button>`).join("");
}

function createControl({ compact = false } = {}) {
  const wrapper = document.createElement("section");
  wrapper.className = compact ? "theme-control theme-control--compact" : "theme-control";
  wrapper.dataset.themeControl = "";
  wrapper.setAttribute("aria-label", "外观主题");
  wrapper.innerHTML = compact
    ? `<div class="theme-segmented" role="group" aria-label="外观主题">${themeButtons()}</div>`
    : `<div class="theme-control__head"><span>外观</span><small>Appearance</small></div><div class="theme-segmented" role="group" aria-label="外观主题">${themeButtons()}</div><p>可跟随系统，也可在本设备固定浅色或深色。</p>`;
  return wrapper;
}

function mountDefaultControls() {
  if (document.querySelector("[data-theme-control]")) return;
  const rail = document.querySelector(".side-rail");
  if (rail) {
    const control = createControl();
    const local = rail.querySelector(".rail-local");
    rail.insertBefore(control, local || null);
    return;
  }
  const popup = document.querySelector(".popup-shell");
  if (popup) {
    const control = createControl({ compact: true });
    const brand = popup.querySelector(".brand-row");
    brand?.insertAdjacentElement("afterend", control);
  }
}

function bindControls() {
  document.addEventListener("click", (event) => {
    const option = event.target.closest?.("[data-theme-option]");
    if (option) {
      applyTheme(option.dataset.themeOption, { persist: true });
      return;
    }
    const cycle = event.target.closest?.("[data-theme-cycle]");
    if (cycle) {
      const current = readThemeMode();
      const next = MODES[(MODES.indexOf(current) + 1) % MODES.length];
      applyTheme(next, { persist: true });
    }
  });

  document.addEventListener("keydown", (event) => {
    const button = event.target.closest?.("[data-theme-option]");
    if (!button || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const controls = [...button.closest("[data-theme-control]").querySelectorAll("[data-theme-option]")];
    let index = controls.indexOf(button);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = controls.length - 1;
    else index = (index + (event.key === "ArrowRight" ? 1 : -1) + controls.length) % controls.length;
    controls[index].focus();
    controls[index].click();
  });
}

export function initializeThemeManager() {
  mountDefaultControls();
  bindControls();
  applyTheme(readThemeMode(), { announce: false });
  media?.addEventListener?.("change", () => {
    if (readThemeMode() === "system") applyTheme("system");
  });
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) applyTheme(event.newValue || "system", { announce: false });
  });
  document.documentElement.classList.add("theme-ready");
}

if (typeof document !== "undefined") initializeThemeManager();
