import { cp, mkdir, readdir, rm } from "node:fs/promises";

const output = "apps/pwa/dist";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp("apps/pwa/src", output, { recursive: true });
await mkdir(`${output}/packages`, { recursive: true });
await cp("dist/packages/content-contract", `${output}/packages/content-contract`, { recursive: true });

async function removeBuildMetadata(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await removeBuildMetadata(path);
    else if (entry.name.endsWith(".d.ts") || entry.name.endsWith(".map")) await rm(path);
  }
}
await removeBuildMetadata(`${output}/packages`);
console.log(`PWA built at ${output}`);
