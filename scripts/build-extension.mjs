import "./sync-memory-gate.mjs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
const output = "apps/extension/dist";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp("apps/extension/src", output, { recursive: true });
await mkdir(`${output}/packages`, { recursive: true });
for (const name of ["domain", "normalizer", "renderers", "integrity", "knowledge-graph", "obsidian-exporter", "content-contract"]) {
  await cp(`dist/packages/${name}`, `${output}/packages/${name}`, { recursive: true });
}

async function removeBuildMetadata(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await removeBuildMetadata(path);
    else if (entry.name.endsWith(".d.ts") || entry.name.endsWith(".map")) await rm(path);
  }
}
await removeBuildMetadata(`${output}/packages`);
console.log(`Extension built at ${output}`);
