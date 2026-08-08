import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectProjects, filterTimeline, groupTimeline } from "../apps/pwa/dist/mobile-core.js";

const output = process.argv[2] || ".tmp/pwa-performance-smoke.json";
const total = 10_000;
const rows = Array.from({ length: total }, (_, index) => ({
  id: `note-${String(index).padStart(5, "0")}`,
  kind: index % 5 === 0 ? "note" : "flash",
  status: index % 13 === 0 ? "archived" : "active",
  title: `移动笔记 ${index}`,
  body: index % 97 === 0 ? `包含目标关键词 stellar ${index}` : `普通离线正文 ${index}`,
  tags: index % 7 === 0 ? ["mobile", "alpha"] : ["mobile"],
  projectId: `project-${index % 120}`,
  projectTitle: `Project ${index % 120}`,
  createdAt: new Date(Date.UTC(2026, 6, 1, 0, 0, index % 60)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 6, 1 + (index % 28), 0, 0, index % 60)).toISOString(),
}));

const start = performance.now();
const projects = collectProjects(rows);
const filtered = filterTimeline(rows, { query: "stellar", status: "active", projectId: "all", kind: "all" });
const visible = filtered.slice(0, 80);
const groups = groupTimeline(visible);
const elapsedMs = performance.now() - start;

async function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    bytes += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
  }
  return bytes;
}

const distBytes = await directoryBytes("apps/pwa/dist");
const report = {
  format: "kv-archive-pwa-performance-smoke",
  version: 1,
  generatedAt: new Date().toISOString(),
  totalRows: total,
  projectCount: projects.length,
  filteredRows: filtered.length,
  firstRenderRows: visible.length,
  firstRenderGroups: groups.length,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  distBytes,
  assertions: {
    projectCount: projects.length === 120,
    boundedFirstRender: visible.length <= 80,
    searchResponsive: elapsedMs < 500,
    installPayloadBounded: distBytes < 2_000_000,
  },
};
if (Object.values(report.assertions).some((value) => !value)) throw new Error(`PWA performance smoke failed: ${JSON.stringify(report)}`);
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
