import { copyFile } from "node:fs/promises";
await copyFile("apps/agent/src/memory-gate.js", "apps/extension/src/memory-gate-core.js");
console.log("Memory Gate core synchronized for extension");
