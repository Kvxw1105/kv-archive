import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAcceptanceDiagnostic,
  classifyAcceptanceFailure,
  renderAcceptanceDiagnosticHtml,
  sanitizeDiagnosticText,
} from "../apps/extension/src/acceptance-diagnostic.js";
import { sanitizeStoredAssetRecord } from "../apps/extension/src/history-store.js";

test("acceptance diagnostic redacts credentials, signed URLs and original names", () => {
  const job = {
    version: 3,
    status: "completed_with_errors",
    accountContext: { workspaceId: "ws-secret-123", workspaceLabel: "Private Team" },
    conversations: [{ id: "11111111-1111-1111-1111-111111111111", title: "Sensitive title" }],
    completedIds: ["11111111-1111-1111-1111-111111111111"],
    failures: [],
    projects: [],
    stats: { regular: 1, archived: 0, projects: 0, projectConversations: 0, retries: 2 },
    assets: {
      inventory: [{
        key: "file:file_abc123",
        fileId: "file_abc123",
        fileName: "private-contract.pdf",
        kind: "user-upload",
        mimeType: "application/pdf",
        downloadable: true,
        expectedBytes: 10,
        references: [{ conversationId: "11111111-1111-1111-1111-111111111111" }],
        conversationIds: ["11111111-1111-1111-1111-111111111111"],
        projectIds: [],
      }],
      failures: [{
        key: "file:file_abc123",
        fileId: "file_abc123",
        fileName: "private-contract.pdf",
        status: 403,
        error: "Bearer secret-token failed at https://files.example/x?sig=secret for file_abc123",
        diagnostic: { signedUrl: "https://files.example/x?sig=secret", attempts: [{ message: "file_abc123 failed" }] },
      }],
    },
  };
  const report = buildAcceptanceDiagnostic({ job, assets: [], extensionVersion: "0.5.1", generatedAt: new Date("2026-07-26T12:00:00Z") });
  const serialized = JSON.stringify(report);
  assert.equal(report.gate.passed, false);
  assert.equal(report.assets.items[0].id, "asset-001");
  assert.equal(report.assets.items[0].extension, ".pdf");
  assert.equal(report.assets.items[0].failure.category, "AUTH");
  for (const secret of ["secret-token", "sig=secret", "file_abc123", "private-contract.pdf", "Sensitive title", "ws-secret-123"]) {
    assert.equal(serialized.includes(secret), false, `must redact ${secret}`);
  }
  const html = renderAcceptanceDiagnosticHtml(report);
  assert.match(html, /真实账号附件验收/);
  assert.doesNotMatch(html, /private-contract/);
});

test("acceptance diagnostic passes only when every discovered item is saved", () => {
  const job = {
    status: "completed",
    conversations: [],
    completedIds: [],
    failures: [],
    stats: {},
    assets: {
      inventory: [{ key: "file:a", fileName: "a.png", kind: "image", downloadable: true, expectedBytes: 3, references: [], conversationIds: [], projectIds: [] }],
      failures: [],
    },
  };
  const report = buildAcceptanceDiagnostic({ job, assets: [{ assetKey: "file:a", fileName: "a.png", mimeType: "image/png", sizeBytes: 3, sha256: "abc" }] });
  assert.equal(report.gate.passed, true);
  assert.equal(report.assets.saved, 1);
  assert.deepEqual(report.gate.blockers, []);
});

test("diagnostic text and cached asset records remove sensitive transport data", () => {
  assert.equal(classifyAcceptanceFailure(413, "too large"), "FILE_TOO_LARGE");
  assert.doesNotMatch(sanitizeDiagnosticText("Bearer abc https://files.example/a?sig=123 file_abc"), /abc|sig=123|file_abc/);
  const clean = sanitizeStoredAssetRecord({
    key: "job:file",
    jobId: "job",
    assetKey: "file:a",
    fileName: "a.png",
    bytes: new Uint8Array([1]),
    sourceUrl: "https://signed.example/a?secret=1",
    downloadUrl: "https://signed.example/b?secret=2",
    accessToken: "secret",
    diagnostics: { signingEndpoint: "global-files-download" },
  });
  assert.equal("sourceUrl" in clean, false);
  assert.equal("downloadUrl" in clean, false);
  assert.equal("accessToken" in clean, false);
  assert.equal(clean.diagnostics.signingEndpoint, "global-files-download");
});
