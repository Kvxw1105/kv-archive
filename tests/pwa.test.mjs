import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCaptureInput,
  collectProjects,
  filterTimeline,
  groupTimeline,
  parseTags,
  slugifyProject,
} from "../apps/pwa/dist/mobile-core.js";
import { createMemoryCaptureStore as createPwaStore } from "../apps/pwa/dist/capture-store.js";
import { createMemoryCaptureStore as createExtensionStore } from "../apps/extension/dist/capture-store.js";
import {
  buildPortableCapturePackage,
  validatePortableCapturePackage,
} from "../apps/pwa/dist/capture-package.js";

const root = new URL("../apps/pwa/dist/", import.meta.url);

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("mobile capture helpers use safe defaults and deterministic project ids", () => {
  assert.equal(slugifyProject("  示例 手机笔记  "), "示例-手机笔记");
  assert.deepEqual(parseTags("AI, 笔记，AI #手机"), ["AI", "笔记", "手机"]);
  const input = buildCaptureInput({ body: "突然想到一个产品细节", projectTitle: "KV Archive", kind: "flash", tags: "产品, 手机" }, "2026-07-29T10:00:00.000Z");
  assert.equal(input.title, "突然想到一个产品细节");
  assert.equal(input.projectId, "kv-archive");
  assert.equal(input.source.metadata.captureSurface, "notes-pwa");
  assert.throws(() => buildCaptureInput({ body: "   " }), /先写一点内容/);
});

test("timeline search, filters and day grouping remain stable", () => {
  const rows = [
    { id: "a", kind: "flash", status: "active", title: "第一条", body: "手机记录", tags: ["灵感"], projectId: "p", projectTitle: "P", updatedAt: "2026-07-29T08:00:00.000Z" },
    { id: "b", kind: "note", status: "archived", title: "第二条", body: "归档内容", tags: [], projectId: null, projectTitle: null, updatedAt: "2026-07-28T08:00:00.000Z" },
  ];
  assert.deepEqual(collectProjects(rows).map((row) => row.id), ["p"]);
  assert.deepEqual(filterTimeline(rows, { query: "手机", status: "active" }).map((row) => row.id), ["a"]);
  assert.deepEqual(filterTimeline(rows, { projectId: "unbound", status: "all" }).map((row) => row.id), ["b"]);
  const groups = groupTimeline(filterTimeline(rows, { status: "all" }));
  assert.equal(groups.length, 2);
});

test("PWA portable package is accepted by the extension recovery engine", async () => {
  const mobile = createPwaStore();
  const created = await mobile.create({ id: "mobile-1", kind: "flash", projectId: "kv", projectTitle: "KV", title: "手机闪念", body: "离线记录", tags: ["mobile"] }, { now: "2026-07-29T10:00:00.000Z" });
  await mobile.update(created.id, { body: "离线记录，稍后整理" }, { expectedRevision: 1, now: "2026-07-29T10:01:00.000Z" });
  const records = await mobile.exportRecords({ projectId: "kv" });
  const packageValue = await buildPortableCapturePackage(records, { sourceAppVersion: "0.16.1", scope: { projectId: "kv" }, now: "2026-07-29T10:02:00.000Z" });
  const validation = await validatePortableCapturePackage(packageValue);
  assert.equal(validation.ok, true);
  assert.equal(packageValue.counts.contentObjects, 1);
  assert.equal(packageValue.counts.contentVersions, 2);

  const extension = createExtensionStore();
  const plan = await extension.analyzePortablePackage(packageValue);
  assert.equal(plan.canApply, true);
  assert.equal(plan.writeCounts.createObjects, 1);
  await extension.applyPortablePackage(packageValue, { now: "2026-07-29T10:03:00.000Z" });
  const imported = await extension.get("mobile-1");
  assert.equal(imported.body, "离线记录，稍后整理");
  assert.equal(imported.revision, 2);
});

test("PWA shell is installable and caches the complete offline runtime", async () => {
  const [html, css, manifestText, sw, icon192, icon512] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("app.css", root), "utf8"),
    readFile(new URL("manifest.webmanifest", root), "utf8"),
    readFile(new URL("sw.js", root), "utf8"),
    readFile(new URL("icons/icon-192.png", root)),
    readFile(new URL("icons/icon-512.png", root)),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /id="capture-form"/);
  assert.match(html, /id="timeline"/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./#timeline");
  assert.equal(manifest.icons.length, 2);
  assert.match(sw, /packages\/content-contract\/src\/index\.js/);
  assert.match(sw, /caches\.open/);
  assert.match(sw, /const CACHE_PREFIX = "kv-archive-notes-"/);
  assert.match(sw, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/);
  assert.doesNotMatch(sw, /keys\.filter\(\(key\) => key !== CACHE_NAME\)/);
  assert.deepEqual(pngDimensions(icon192), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions(icon512), { width: 512, height: 512 });
});

test("mobile timeline keeps bounded paging and reversible archived/trash actions", async () => {
  const app = await readFile(new URL("app.js", root), "utf8");
  assert.match(app, /let timelineLimit = 80/);
  assert.match(app, /data-load-more="true"/);
  assert.match(app, /if \(more\) \{ timelineLimit \+= 80/);
  assert.match(app, /item\.status === "archived"[\s\S]*?取消归档/);
  assert.match(app, /item\.status === "trashed"\n\s*\? `<button data-action="restore"/);
});

test("PWA recovery tools expose staged task feedback", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("app.js", root), "utf8"),
    readFile(new URL("app.css", root), "utf8"),
  ]);
  assert.match(html, /id="mobile-task"/);
  assert.match(app, /startMobileTask/);
  assert.match(app, /正在分析恢复包/);
  assert.match(app, /正在写入恢复包/);
  assert.match(app, /正在分析安全回滚/);
  assert.match(css, /\.mobile-task/);
});


test("PWA Project export reads version history through objectId indexes", async () => {
  const source = await readFile(new URL("../src/capture-store.js", root), "utf8");
  const start = source.indexOf("    async exportRecords(filters = {})");
  const block = source.slice(start, source.indexOf("    async analyzePortablePackage", start));
  assert.match(block, /recordsForIndexValues\(db, VERSIONS, "objectId", \[\.\.\.ids\]\)/);
  assert.doesNotMatch(block, /this\.listAllVersions\(projectId\)/);
});
