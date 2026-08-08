import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeThemeMode, resolveTheme } from "../apps/extension/src/theme-manager.js";

const extensionPages = ["backup", "basket", "capture", "knowledge", "library", "memory", "state", "popup"];

test("all extension surfaces load the no-flash theme bootstrap and shared theme manager", async () => {
  for (const page of extensionPages) {
    const html = await readFile(`apps/extension/src/${page}.html`, "utf8");
    const bootstrap = html.indexOf('src="theme-bootstrap.js"');
    const firstStylesheet = html.indexOf('<link rel="stylesheet"');
    assert.ok(bootstrap >= 0, `${page} should load theme-bootstrap.js`);
    assert.ok(bootstrap < firstStylesheet, `${page} should apply theme before styles to avoid a flash`);
    assert.match(html, /href="theme\.css"/, `${page} should load shared semantic theme CSS`);
    assert.match(html, /type="module" src="theme-manager\.js"/, `${page} should load the theme controller`);
  }
});

test("theme manager resolves explicit and system modes deterministically", () => {
  assert.equal(normalizeThemeMode(null), "system");
  assert.equal(normalizeThemeMode("light"), "light");
  assert.equal(normalizeThemeMode("dark"), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("theme manager supports persisted system, light, and dark modes", async () => {
  const [bootstrap, manager, css] = await Promise.all([
    readFile("apps/extension/src/theme-bootstrap.js", "utf8"),
    readFile("apps/extension/src/theme-manager.js", "utf8"),
    readFile("apps/extension/src/theme.css", "utf8"),
  ]);
  assert.match(bootstrap, /kv-archive-theme-mode/);
  assert.match(bootstrap, /prefers-color-scheme: dark/);
  assert.match(bootstrap, /dataset\.themeMode/);
  assert.match(manager, /\["system", "light", "dark"\]/);
  assert.match(manager, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(manager, /media\?\.addEventListener\?\.\("change"/);
  assert.match(manager, /window\.addEventListener\("storage"/);
  assert.match(manager, /data-theme-option/);
  assert.match(manager, /aria-pressed/);
  assert.match(manager, /ArrowLeft/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /color-scheme: light/);
  assert.match(css, /color-scheme: dark/);
  assert.match(css, /\.theme-segmented/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Notes PWA exposes the same three-mode appearance contract offline", async () => {
  const [html, css, sw] = await Promise.all([
    readFile("apps/pwa/src/index.html", "utf8"),
    readFile("apps/pwa/src/theme.css", "utf8"),
    readFile("apps/pwa/src/sw.js", "utf8"),
  ]);
  assert.match(html, /data-theme-cycle/);
  for (const mode of ["system", "light", "dark"]) assert.match(html, new RegExp(`data-theme-option="${mode}"`));
  assert.match(html, /theme-bootstrap\.js/);
  assert.match(html, /theme-manager\.js/);
  assert.match(html, /theme\.css/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  for (const asset of ["theme.css", "theme-bootstrap.js", "theme-manager.js"]) assert.match(sw, new RegExp(asset.replace(".", "\\.")));
});
