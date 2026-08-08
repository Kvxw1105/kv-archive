import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const extensionPages = ["backup", "basket", "capture", "knowledge", "library", "memory", "state", "popup"];

function rgb(hex) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? [...clean].map((part) => `${part}${part}`).join("") : clean;
  return [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16));
}

function luminance(hex) {
  const weights = [0.2126, 0.7152, 0.0722];
  return rgb(hex)
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * weights[index], 0);
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function themeVariables(css, theme) {
  const match = css.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `visibility CSS should define ${theme} tokens`);
  const variables = {};
  for (const item of match[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) variables[item[1]] = item[2];
  return variables;
}

function assertPair(vars, foreground, background, label, minimum = 4.5) {
  assert.ok(vars[foreground], `${label} should define ${foreground}`);
  assert.ok(vars[background], `${label} should define ${background}`);
  const ratio = contrast(vars[foreground], vars[background]);
  assert.ok(ratio >= minimum, `${label} contrast ${ratio.toFixed(2)} should be at least ${minimum}`);
}

test("every extension surface loads visibility hardening after the semantic theme", async () => {
  for (const page of extensionPages) {
    const html = await readFile(`apps/extension/src/${page}.html`, "utf8");
    const theme = html.indexOf('href="theme.css"');
    const visibility = html.indexOf('href="visibility.css"');
    assert.ok(theme >= 0, `${page} should load theme.css`);
    assert.ok(visibility > theme, `${page} should load visibility.css after theme.css`);
  }
  const pwa = await readFile("apps/pwa/src/index.html", "utf8");
  assert.ok(pwa.indexOf('href="./visibility.css"') > pwa.indexOf('href="./theme.css"'));
});

test("visibility tokens keep normal and control text above WCAG AA contrast", async () => {
  const css = await readFile("apps/extension/src/visibility.css", "utf8");
  const dark = themeVariables(css, "dark");
  const light = themeVariables(css, "light");

  for (const [name, vars, panel] of [["dark", dark, "#121411"], ["light", light, "#f8f6f0"]]) {
    for (const token of ["--kv-text", "--kv-muted", "--kv-faint"]) {
      const ratio = contrast(vars[token], panel);
      assert.ok(ratio >= 4.5, `${name} ${token} contrast ${ratio.toFixed(2)} should be at least 4.5`);
    }
    assertPair(vars, "--kv-primary-text", "--kv-primary-bg", `${name} primary`);
    assertPair(vars, "--kv-secondary-text", "--kv-secondary-bg", `${name} secondary`);
    assertPair(vars, "--kv-ghost-text", "--kv-ghost-bg", `${name} ghost`);
    assertPair(vars, "--kv-disabled-text", "--kv-disabled-bg", `${name} disabled`);
    assertPair(vars, "--kv-on-danger", "--kv-danger", `${name} danger`);
  }
});

test("all CSS custom properties used by extension and PWA styles are defined", async () => {
  const roots = ["apps/extension/src", "apps/pwa/src"];
  const sources = [];
  for (const root of roots) {
    for (const name of await readdir(root)) {
      if (name.endsWith(".css")) sources.push(await readFile(`${root}/${name}`, "utf8"));
    }
  }
  const css = sources.join("\n");
  const definitions = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const uses = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
  const unresolved = [...uses].filter((name) => !definitions.has(name));
  assert.deepEqual(unresolved, []);
});

test("visibility layer covers popup, dense pages, custom buttons, and waiting feedback", async () => {
  const [extensionCss, pwaCss, serviceWorker] = await Promise.all([
    readFile("apps/extension/src/visibility.css", "utf8"),
    readFile("apps/pwa/src/visibility.css", "utf8"),
    readFile("apps/pwa/src/sw.js", "utf8"),
  ]);
  for (const selector of [
    ".result", ".quick-action", ".selected-item button", ".item-actions button", ".close",
    ".task-feedback__detail", ".destination small", ".conversation-copy span", ".gate-table",
  ]) assert.match(extensionCss, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(extensionCss, /body:has\(\.popup-shell\)[\s\S]*width:\s*430px/);
  assert.match(extensionCss, /--kv-font-body:\s*15px/);
  assert.match(pwaCss, /button:disabled/);
  assert.match(pwaCss, /\.note-card p/);
  assert.match(serviceWorker, /visibility\.css/);
});

test("visibility hardening preserves hidden states and a 12px interactive-copy floor", async () => {
  const css = await readFile("apps/extension/src/visibility.css", "utf8");
  assert.match(css, /\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /Interactive microcopy uses a 12px floor/);
  for (const selector of [
    ".quick-action small",
    ".health-grid span",
    ".gate-controls label",
    ".output-tree .phase",
    ".app-header .brand-lockup .brand-name",
    ".side-rail .brand-lockup .brand-name",
  ]) assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Notes PWA separates accent text from white-on-color button surfaces", async () => {
  const css = await readFile("apps/pwa/src/visibility.css", "utf8");
  for (const name of ["light", "dark"]) {
    const blocks = [...css.matchAll(new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "g"))]
      .map((match) => match[1]);
    const value = blocks.map((block) => block.match(/--wine-control\s*:\s*(#[0-9a-fA-F]{6})/))
      .find(Boolean)?.[1];
    assert.ok(value, `${name} PWA should define --wine-control`);
    const ratio = contrast("#ffffff", value);
    assert.ok(ratio >= 4.5, `${name} PWA control contrast ${ratio.toFixed(2)} should be at least 4.5`);
  }
  assert.match(css, /\.quick-add[\s\S]*background:\s*var\(--wine-control\)/);
});
