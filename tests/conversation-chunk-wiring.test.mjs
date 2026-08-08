import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { CONTEXT_VAULT_DB_VERSION } from "../apps/extension/src/db-schema.js";

test("history store wires chunk plans into legacy put/getArtifact without a database migration", async () => {
  const source = await readFile("apps/extension/src/history-store.js", "utf8");
  assert.match(source, /buildConversationStoragePlan\(raw\)/);
  assert.match(source, /putContentObjectsIfMissing\(plan\.records\)/);
  assert.match(source, /object\.kind !== "conversation-manifest"/);
  assert.match(source, /manifestReferencedObjectKeys\(object\.payload\)/);
  assert.match(source, /manifestNestedObjectKeys\(object\.payload, firstLevel\)/);
  assert.match(source, /restoreConversationFromManifest\(object\.payload, referenced\)/);
  assert.equal(CONTEXT_VAULT_DB_VERSION, 13);
});

test("snapshot garbage collection expands manifest dependencies before deletion", async () => {
  const source = await readFile("apps/extension/src/content-snapshots.js", "utf8");
  const start = source.indexOf("export async function applySnapshotRetention");
  const body = source.slice(start);
  assert.match(body, /expandReferencedObjectKeys\(directReferences, objects\)/);
  assert.ok(body.indexOf("expandReferencedObjectKeys(directReferences, objects)") < body.indexOf("if \(referenced\.has\(object\.key\)\) continue"));
});


test("incremental storage reuse is accumulated and surfaced by scheduled snapshot status", async () => {
  const [engine, snapshots, backup, html] = await Promise.all([
    readFile("apps/extension/src/history-engine.js", "utf8"),
    readFile("apps/extension/src/content-snapshots.js", "utf8"),
    readFile("apps/extension/src/backup.js", "utf8"),
    readFile("apps/extension/src/backup.html", "utf8"),
  ]);
  assert.match(engine, /incrementalBytesReused = Number\(job\.stats\.incrementalBytesReused/);
  assert.match(engine, /reusedByKind\?\.\["conversation-node"\]/);
  assert.match(snapshots, /incrementalBytesReused: Number\(job\.stats\?\.incrementalBytesReused/);
  assert.match(backup, /latestSnapshot\?\.stats\?\.incrementalBytesReused/);
  assert.match(html, /本轮复用节省/);
});
