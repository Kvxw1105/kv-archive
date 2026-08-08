import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("extension exposes reviewed Memory Sync Center without silent send", async () => {
  const manifest = JSON.parse(await readFile("apps/extension/src/manifest.json", "utf8"));
  assert.equal(manifest.version, "0.16.11");
  assert.ok(manifest.permissions.includes("scripting"));
  const html = await readFile("apps/extension/src/memory.html", "utf8");
  for (const id of ["project","mode","budget","query","generate","copy","insert","approve","export","preview","diff","versions"]) assert.match(html,new RegExp(`id=["']${id}["']`));
  const source = await readFile("apps/extension/src/memory.js", "utf8");
  assert.match(source,/chrome\.scripting\.executeScript/);
  assert.match(source,/dispatchEvent\(new (?:Event|InputEvent)/);
  assert.doesNotMatch(source,/click\(\).*send|sendButton|button\[data-testid=.*send/i);
  const popup = await readFile("apps/extension/src/popup.html", "utf8");
  assert.match(popup,/id="memory"/);
});
