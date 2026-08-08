import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("CLI generates all MVP outputs", async () => {
  const output = await mkdtemp(join(tmpdir(), "context-vault-"));
  try {
    const result = spawnSync(process.execPath, [
      "dist/apps/cli/src/index.js",
      "normalize",
      "fixtures/synthetic/multi-branch-conversation.json",
      "--output",
      output,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    for (const file of ["raw.json", "canonical.json", "conversation.md", "integrity-report.json"]) {
      assert.ok((await readFile(join(output, file), "utf8")).length > 0);
    }
    const report = JSON.parse(await readFile(join(output, "integrity-report.json"), "utf8"));
    assert.equal(report.status, "PARTIAL");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("CLI returns a non-zero status for a missing input", () => {
  const result = spawnSync(process.execPath, [
    "dist/apps/cli/src/index.js",
    "normalize",
    "fixtures/synthetic/does-not-exist.json",
    "--output",
    ".tmp/missing",
  ], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
});
