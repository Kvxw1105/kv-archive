import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationMetadata,
  normalizeAuthContext,
  normalizeConversationListResponse,
  normalizeProjectConversationListResponse,
  normalizeProjectListResponse,
  projectMetadata,
  normalizeSignedAssetResponse,
  decodeBase64Chunks,
  decodeBase64ChunkInto,
  createChatGPTTransport,
} from "../apps/extension/src/history-api.js";

test("normalizes common and nested conversation list response shapes", () => {
  assert.deepEqual(normalizeConversationListResponse({ items: [{ id: "a" }], total: 1 }), {
    items: [{ id: "a" }],
    total: 1,
  });
  assert.deepEqual(normalizeConversationListResponse({ data: { conversations: [{ id: "b" }], count: 2 } }), {
    items: [{ id: "b" }],
    total: 2,
  });
  assert.deepEqual(normalizeConversationListResponse({ conversations: { items: [{ id: "c" }] } }), {
    items: [{ id: "c" }],
    total: null,
  });
});

test("extracts source-aware conversation metadata", () => {
  const metadata = conversationMetadata(
    { id: "a", title: " Test ", create_time: 1, update_time: 2 },
    { sourceType: "project", projectId: "g-p-1", projectTitle: "Alpha", workspaceId: "ws-123" },
  );
  assert.equal(metadata.id, "a");
  assert.equal(metadata.title, "Test");
  assert.equal(metadata.projectId, "g-p-1");
  assert.deepEqual(metadata.locations, [{ type: "project", projectId: "g-p-1", projectTitle: "Alpha", workspaceId: "ws-123", present: true }]);
  assert.equal(conversationMetadata({ title: "missing" }), null);
});

test("normalizes both known project sidebar wrapper shapes", () => {
  const nested = projectMetadata({
    gizmo: {
      gizmo: { id: "g-p-nested", display: { name: "Nested", description: "D" }, workspace_id: "ws-1" },
      files: [{ file_id: "f1" }],
      conversations: { items: [{ id: "c1" }], cursor: "next" },
    },
  });
  assert.equal(nested.id, "g-p-nested");
  assert.equal(nested.title, "Nested");
  assert.equal(nested.files.length, 1);
  assert.equal(nested.embeddedCursor, "next");

  const flat = normalizeProjectListResponse({
    items: [{ gizmo: { id: "g-p-flat", display: { name: "Flat" } } }],
    cursor: null,
  });
  assert.equal(flat.items[0].id, "g-p-flat");
  assert.equal(flat.cursor, null);
});

test("normalizes project conversation pages and preserves project source", () => {
  const response = normalizeProjectConversationListResponse(
    { conversations: { items: [{ id: "c1", title: "One" }], cursor: "cursor-2" } },
    { id: "g-p-1", title: "Project", workspaceId: "ws-1" },
  );
  assert.equal(response.cursor, "cursor-2");
  assert.equal(response.items[0].locations[0].type, "project");
  assert.equal(response.items[0].locations[0].projectId, "g-p-1");
});

test("derives a temporary active workspace context without persisting credentials", () => {
  const context = normalizeAuthContext({
    accessToken: "secret-token",
    user: {
      accounts: {
        first: { account_id: "11111111-1111-1111-1111-111111111111", name: "Old" },
        second: { account_id: "22222222-2222-2222-2222-222222222222", name: "Team", is_current_account: true },
      },
    },
  }, { deviceId: "device-1" });
  assert.equal(context.accessToken, "secret-token");
  assert.equal(context.workspaceId, "22222222-2222-2222-2222-222222222222");
  assert.equal(context.workspaceLabel, "Team");
  assert.equal(context.deviceId, "device-1");
  assert.equal(context.workspaceCandidates.length, 2);
});


test("normalizes signed attachment metadata",()=>{const signed=normalizeSignedAssetResponse({download_url:"https://files.example/x",file_name:"x.pdf",file_size_bytes:10,content_type:"application/pdf"});assert.equal(signed.downloadUrl,"https://files.example/x");assert.equal(signed.fileName,"x.pdf");assert.equal(signed.sizeBytes,10);assert.throws(()=>normalizeSignedAssetResponse({}),/下载/);});
test("decodes chunked base64 attachment transport and rejects truncated payloads",()=>{const chunks=[Buffer.from([1,2,3]).toString("base64"),Buffer.from([4,5]).toString("base64")];assert.deepEqual([...decodeBase64Chunks(chunks,5)],[1,2,3,4,5]);assert.throws(()=>decodeBase64Chunks(chunks,6),/不完整/);});


test("decodes one attachment chunk directly into a preallocated target",()=>{const output=new Uint8Array(5);const written=decodeBase64ChunkInto(Buffer.from([1,2,3]).toString("base64"),output,1);assert.equal(written,3);assert.deepEqual([...output],[0,1,2,3,0]);assert.throws(()=>decodeBase64ChunkInto(Buffer.from([1,2,3]).toString("base64"),output,4),/缓冲区/);});

test("refreshes ChatGPT auth context once after a long-running request receives 401", async () => {
  const previousChrome = globalThis.chrome;
  let contextReads = 0;
  let apiReads = 0;
  globalThis.chrome = {
    scripting: {
      async executeScript(input) {
        if (!input.args) {
          contextReads += 1;
          return [{ result: {
            session: { accessToken: contextReads === 1 ? "stale-token" : "fresh-token" },
            nextData: null,
            storageEntries: [],
            deviceId: "device-1",
          } }];
        }
        apiReads += 1;
        const headers = input.args[1];
        if (apiReads === 1) {
          assert.equal(headers.Authorization, "Bearer stale-token");
          return [{ result: { ok: false, status: 401, statusText: "Unauthorized", url: input.args[0], payload: { detail: "expired" }, retryAfter: null, parseFailed: false } }];
        }
        assert.equal(headers.Authorization, "Bearer fresh-token");
        return [{ result: { ok: true, status: 200, statusText: "OK", url: input.args[0], payload: { items: [], total: 0 }, retryAfter: null, parseFailed: false } }];
      },
    },
  };
  try {
    const transport = createChatGPTTransport(1);
    const result = await transport.listConversations({ offset: 0, limit: 1, archived: false });
    assert.equal(result.total, 0);
    assert.equal(contextReads, 2);
    assert.equal(apiReads, 2);
  } finally {
    globalThis.chrome = previousChrome;
  }
});
