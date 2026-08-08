import { rm } from "node:fs/promises";
for (const path of ["dist", "apps/extension/dist"]) {
  await rm(path, { recursive: true, force: true });
}
