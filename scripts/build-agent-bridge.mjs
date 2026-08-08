import { cp, mkdir, rm, writeFile, chmod, readFile } from "node:fs/promises";

const VERSION = JSON.parse(await readFile("package.json", "utf8")).version;
const PRODUCT = "KV Archive";

await writeFile("apps/agent/src/version.js", `export const BRIDGE_VERSION = ${JSON.stringify(VERSION)};\n`);
await rm("apps/agent-bridge", { recursive: true, force: true });
await mkdir("apps/agent-bridge/dist", { recursive: true });
await mkdir("apps/agent-bridge/configs", { recursive: true });
await mkdir("apps/agent-bridge/examples", { recursive: true });
await cp("apps/agent/src", "apps/agent-bridge/dist/agent", { recursive: true });
await cp("apps/extension/src/state-governance.js", "apps/agent-bridge/dist/agent/state-governance.js");
await writeFile("apps/agent-bridge/package.json", JSON.stringify({
  name: "kv-archive-agent-bridge",
  version: VERSION,
  private: true,
  type: "module",
  engines: { node: ">=20" },
  bin: {
    "kv-archive-agent": "dist/agent/index.js",
    "context-vault-agent": "dist/agent/index.js",
  },
}, null, 2) + "\n");

const shellScripts = {
  "start-agent.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 1 ]; then echo "Usage: $0 /path/to/KV-Archive-Agent-Bundle.zip [proposal-directory]" >&2; exit 2; fi\nPROPOSAL_DIR=${2:-./kv-archive-proposals}\nexec node "$DIR/dist/agent/index.js" serve --bundle "$1" --proposal-dir "$PROPOSAL_DIR"\n',
  "inspect-bundle.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$DIR/dist/agent/index.js" inspect --bundle "$1"\n',
  "propose-state.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 2 ]; then echo "Usage: $0 /path/to/Bundle.zip /path/to/proposal-draft.json [proposal-directory]" >&2; exit 2; fi\nPROPOSAL_DIR=${3:-./kv-archive-proposals}\nexec node "$DIR/dist/agent/index.js" propose --bundle "$1" --input "$2" --proposal-dir "$PROPOSAL_DIR"\n',
  "create-benchmark.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 3 ]; then echo "Usage: $0 /path/to/Bundle.zip PROJECT OUTPUT_DIRECTORY" >&2; exit 2; fi\nexec node "$DIR/dist/agent/index.js" benchmark-create --bundle "$1" --project "$2" --output "$3"\n',
  "score-benchmark.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 4 ]; then echo "Usage: $0 /path/to/Bundle.zip answer-key.json response.json OUTPUT_DIRECTORY" >&2; exit 2; fi\nexec node "$DIR/dist/agent/index.js" benchmark-score --bundle "$1" --benchmark "$2" --response "$3" --output "$4"\n',
  "create-gate-benchmark.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 4 ]; then echo "Usage: $0 Bundle.zip PROJECT QUERY OUTPUT_DIRECTORY [POLICY]" >&2; exit 2; fi\nPOLICY=${5:-balanced}\nexec node "$DIR/dist/agent/index.js" benchmark-gate-create --bundle "$1" --project "$2" --query "$3" --output "$4" --policy "$POLICY"\n',
  "score-gate-benchmark.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 5 ]; then echo "Usage: $0 Bundle.zip answer-key.json response-off.json response-on.json OUTPUT_DIRECTORY" >&2; exit 2; fi\nexec node "$DIR/dist/agent/index.js" benchmark-gate-score --bundle "$1" --benchmark "$2" --response-off "$3" --response-on "$4" --output "$5"\n',
  "run-memory-gate.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 3 ]; then echo "Usage: $0 /path/to/Bundle.zip PROJECT OUTPUT_DIRECTORY [POLICY] [TOKEN_BUDGET]" >&2; exit 2; fi\nPOLICY=${4:-balanced}\nTOKEN_BUDGET=${5:-2048}\nexec node "$DIR/dist/agent/index.js" memory-gate --bundle "$1" --project "$2" --output "$3" --policy "$POLICY" --token-budget "$TOKEN_BUDGET"\n',
  "create-handoff.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 4 ]; then echo "Usage: $0 Bundle.zip PROJECT GOAL OUTPUT_DIRECTORY [POLICY]" >&2; exit 2; fi\nPOLICY=${5:-balanced}\nexec node "$DIR/dist/agent/index.js" handoff-create --bundle "$1" --project "$2" --query "$3" --output "$4" --policy "$POLICY"\n',
  "receive-handoff.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 2 ]; then echo "Usage: $0 Receiver-Handoff.zip OUTPUT_DIRECTORY [RECEIVER_NAME]" >&2; exit 2; fi\nRECEIVER=${3:-receiving-agent}\nexec node "$DIR/dist/agent/index.js" handoff-receive --handoff "$1" --output "$2" --receiver "$RECEIVER"\n',
  "verify-handoff.sh": '#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -lt 5 ]; then echo "Usage: $0 Receiver-Handoff.zip Private-Verification-Kit.zip Receiver-Receipt.json Response.json OUTPUT_DIRECTORY" >&2; exit 2; fi\nexec node "$DIR/dist/agent/index.js" handoff-verify --handoff "$1" --verification-kit "$2" --receiver-receipt "$3" --response "$4" --output "$5"\n',
};
const cmdScripts = {
  "start-agent.cmd": '@echo off\r\nif "%~1"=="" (echo Usage: start-agent.cmd C:\\path\\KV-Archive-Agent-Bundle.zip [proposal-directory] & exit /b 2)\r\nset "PROPOSAL_DIR=%~2"\r\nif "%PROPOSAL_DIR%"=="" set "PROPOSAL_DIR=%CD%\\kv-archive-proposals"\r\nnode "%~dp0dist\\agent\\index.js" serve --bundle "%~1" --proposal-dir "%PROPOSAL_DIR%"\r\n',
  "inspect-bundle.cmd": '@echo off\r\nnode "%~dp0dist\\agent\\index.js" inspect --bundle "%~1"\r\n',
  "propose-state.cmd": '@echo off\r\nif "%~2"=="" (echo Usage: propose-state.cmd Bundle.zip proposal-draft.json [proposal-directory] & exit /b 2)\r\nset "PROPOSAL_DIR=%~3"\r\nif "%PROPOSAL_DIR%"=="" set "PROPOSAL_DIR=%CD%\\kv-archive-proposals"\r\nnode "%~dp0dist\\agent\\index.js" propose --bundle "%~1" --input "%~2" --proposal-dir "%PROPOSAL_DIR%"\r\n',
  "create-benchmark.cmd": '@echo off\r\nif "%~3"=="" (echo Usage: create-benchmark.cmd Bundle.zip PROJECT OUTPUT_DIRECTORY & exit /b 2)\r\nnode "%~dp0dist\\agent\\index.js" benchmark-create --bundle "%~1" --project "%~2" --output "%~3"\r\n',
  "score-benchmark.cmd": '@echo off\r\nif "%~4"=="" (echo Usage: score-benchmark.cmd Bundle.zip answer-key.json response.json OUTPUT_DIRECTORY & exit /b 2)\r\nnode "%~dp0dist\\agent\\index.js" benchmark-score --bundle "%~1" --benchmark "%~2" --response "%~3" --output "%~4"\r\n',
  "create-gate-benchmark.cmd": '@echo off\r\nif "%~4"=="" (echo Usage: create-gate-benchmark.cmd Bundle.zip PROJECT QUERY OUTPUT_DIRECTORY [POLICY] & exit /b 2)\r\nset "POLICY=%~5"\r\nif "%POLICY%"=="" set "POLICY=balanced"\r\nnode "%~dp0dist\\agent\\index.js" benchmark-gate-create --bundle "%~1" --project "%~2" --query "%~3" --output "%~4" --policy "%POLICY%"\r\n',
  "score-gate-benchmark.cmd": '@echo off\r\nif "%~5"=="" (echo Usage: score-gate-benchmark.cmd Bundle.zip answer-key.json response-off.json response-on.json OUTPUT_DIRECTORY & exit /b 2)\r\nnode "%~dp0dist\\agent\\index.js" benchmark-gate-score --bundle "%~1" --benchmark "%~2" --response-off "%~3" --response-on "%~4" --output "%~5"\r\n',
  "run-memory-gate.cmd": '@echo off\r\nif "%~3"=="" (echo Usage: run-memory-gate.cmd Bundle.zip PROJECT OUTPUT_DIRECTORY [POLICY] [TOKEN_BUDGET] & exit /b 2)\r\nset "POLICY=%~4"\r\nif "%POLICY%"=="" set "POLICY=balanced"\r\nset "TOKEN_BUDGET=%~5"\r\nif "%TOKEN_BUDGET%"=="" set "TOKEN_BUDGET=2048"\r\nnode "%~dp0dist\\agent\\index.js" memory-gate --bundle "%~1" --project "%~2" --output "%~3" --policy "%POLICY%" --token-budget "%TOKEN_BUDGET%"\r\n',
  "create-handoff.cmd": '@echo off\r\nif "%~4"=="" (echo Usage: create-handoff.cmd Bundle.zip PROJECT GOAL OUTPUT_DIRECTORY [POLICY] & exit /b 2)\r\nset "POLICY=%~5"\r\nif "%POLICY%"=="" set "POLICY=balanced"\r\nnode "%~dp0dist\\agent\\index.js" handoff-create --bundle "%~1" --project "%~2" --query "%~3" --output "%~4" --policy "%POLICY%"\r\n',
  "receive-handoff.cmd": '@echo off\r\nif "%~2"=="" (echo Usage: receive-handoff.cmd Receiver-Handoff.zip OUTPUT_DIRECTORY [RECEIVER_NAME] & exit /b 2)\r\nset "RECEIVER=%~3"\r\nif "%RECEIVER%"=="" set "RECEIVER=receiving-agent"\r\nnode "%~dp0dist\\agent\\index.js" handoff-receive --handoff "%~1" --output "%~2" --receiver "%RECEIVER%"\r\n',
  "verify-handoff.cmd": '@echo off\r\nif "%~5"=="" (echo Usage: verify-handoff.cmd Receiver-Handoff.zip Private-Verification-Kit.zip Receiver-Receipt.json Response.json OUTPUT_DIRECTORY & exit /b 2)\r\nnode "%~dp0dist\\agent\\index.js" handoff-verify --handoff "%~1" --verification-kit "%~2" --receiver-receipt "%~3" --response "%~4" --output "%~5"\r\n',
};
for (const [name, content] of Object.entries(shellScripts)) {
  await writeFile(`apps/agent-bridge/${name}`, content);
  await chmod(`apps/agent-bridge/${name}`, 0o755);
}
for (const [name, content] of Object.entries(cmdScripts)) await writeFile(`apps/agent-bridge/${name}`, content);

const args = ["/ABSOLUTE/PATH/kv-archive-agent-bridge/dist/agent/index.js", "serve", "--bundle", "/ABSOLUTE/PATH/KV-Archive-Agent-Bundle.zip", "--proposal-dir", "/ABSOLUTE/PATH/kv-archive-proposals"];
const codex = `[mcp_servers.kv_archive]\ncommand = "node"\nargs = [${args.map((value) => JSON.stringify(value)).join(", ")}]\nstartup_timeout_ms = 20000\n`;
const vscode = { servers: { kvArchive: { type: "stdio", command: "node", args } } };
const generic = { mcpServers: { kvArchive: { command: "node", args } } };
await writeFile("apps/agent-bridge/configs/codex-config.toml", codex);
await writeFile("apps/agent-bridge/configs/vscode-mcp.json", JSON.stringify(vscode, null, 2) + "\n");
await writeFile("apps/agent-bridge/configs/claude-cursor.json", JSON.stringify(generic, null, 2) + "\n");
await writeFile("apps/agent-bridge/examples/proposal-draft.json", JSON.stringify({
  project: "REPLACE_WITH_PROJECT_ID_OR_TITLE",
  kind: "project_status",
  title: "Describe the reviewed state change",
  rationale: "Explain why the cited evidence supports this proposal.",
  expectedImpact: "Describe the expected effect after human approval.",
  riskLevel: "low",
  evidenceUris: ["contextvault://conversation/REPLACE/node/REPLACE?evidence=REPLACE"],
  change: { phase: "REPLACE_WITH_NEW_PHASE" },
}, null, 2) + "\n");

const fence = "```";
const tick = "`";
const readme = [
  `# ${PRODUCT} Agent Bridge v${VERSION}`,
  "",
  "A dependency-free MCP stdio server with read-only conversation evidence, unified notes/content access, review-required state proposals, deterministic Context Packs, and Continuity Benchmark scoring. Requires Node.js 20+.",
  "",
  "## 1. Export a bundle",
  "",
  `Open ${PRODUCT} > Local Library and click **Export Agent Bundle**. Keep the bundle private. Binary attachments are not included.`,
  "",
  "## 2. Verify the bundle",
  "",
  `${fence}bash`,
  "node dist/agent/index.js inspect --bundle /path/to/KV-Archive-Agent-Bundle.zip",
  fence,
  "",
  "## 3. Start MCP over stdio",
  "",
  `${fence}bash`,
  "node dist/agent/index.js serve --bundle /path/to/KV-Archive-Agent-Bundle.zip --proposal-dir ./kv-archive-proposals",
  fence,
  "",
  `Use the examples in ${tick}configs/${tick}. Replace all absolute paths.`,
  "",
  "## Tools",
  "",
  "Read-only evidence and approved-state tools:",
  "",
  ...["vault_stats", "list_projects", "search_messages", "list_content_objects", "search_content", "read_content_object", "read_conversation", "get_project_snapshot", "get_source_evidence", "run_memory_gate", "build_context_pack"].map((name) => `- ${tick}${name}${tick}`),
  "",
  "Controlled proposal tool:",
  "",
  `- ${tick}create_state_proposal${tick}`,
  "",
  "The proposal tool writes one JSON file into the local proposal outbox. It cannot approve the file or mutate approved Project state.",
  "",
  "## Continuity Benchmark",
  "",
  "Create a challenge and private answer key:",
  "",
  `${fence}bash`,
  './create-benchmark.sh /path/to/bundle.zip "AtlasDemo" ./benchmark-run',
  fence,
  "",
  "Give only `PROMPT.md`, `benchmark-challenge.json`, and `response-template.json` to the receiving Agent. Keep `benchmark-answer-key.json` private.",
  "",
  "Score the returned JSON:",
  "",
  `${fence}bash`,
  "./score-benchmark.sh /path/to/bundle.zip ./benchmark-run/benchmark-answer-key.json ./agent-response.json ./benchmark-report",
  fence,
  "",
  "A PASS requires at least 85/100 and no critical identity, evidence, or unsupported-record errors.",
  "",
  "## Memory Gate",
  "",
  `${fence}bash`,
  './run-memory-gate.sh /path/to/bundle.zip "AtlasDemo" ./memory-gate balanced 2048',
  fence,
  "",
  "The report classifies approved-state candidates as INCLUDE, EXCLUDE, or REVIEW and never mutates approved state.",
  "",
  "## Paired Memory Gate benchmark",
  "",
  `${fence}bash`,
  './create-gate-benchmark.sh /path/to/bundle.zip "AtlasDemo" "Continue the current milestone" ./gate-experiment balanced',
  './score-gate-benchmark.sh /path/to/bundle.zip ./gate-experiment/benchmark-answer-key.json ./gate-experiment/response-gate-off.json ./gate-experiment/response-gate-on.json ./gate-comparison',
  fence,
  "",
  "The scorer reports score and dimension deltas. It does not assume the Gate improves every model or task.",
  "",
  "## Verified Handoff",
  "",
  "Create a project-scoped receiver package and a separate private verification kit:",
  "",
  `${fence}bash`,
  './create-handoff.sh /path/to/bundle.zip "AtlasDemo" "Continue the current milestone" ./handoff-sender balanced',
  fence,
  "",
  "Send only the `KV-Archive-Verified-Handoff-*.zip` file. Keep the Verification Kit private.",
  "",
  "Receiver preflight and extraction:",
  "",
  `${fence}bash`,
  './receive-handoff.sh ./KV-Archive-Verified-Handoff-*.zip ./handoff-receiver Codex',
  fence,
  "",
  "After the receiving Agent returns `handoff-response.json`, verify it with the private kit and receiver receipt:",
  "",
  `${fence}bash`,
  './verify-handoff.sh ./KV-Archive-Verified-Handoff-*.zip ./KV-Archive-Handoff-Verification-Kit-*.zip ./handoff-receiver/receiver-preflight-receipt-*.json ./handoff-receiver/handoff-response.json ./handoff-verification',
  fence,
  "",
  "A verified PASS requires package integrity, matching sender/receiver receipts, a matching approved-state identity, and a Continuity Benchmark PASS with no critical evidence or identity errors.",
  "",
  "## Context Pack generation",
  "",
  `${fence}bash`,
  'node dist/agent/index.js pack --bundle /path/to/bundle.zip --project-title "AtlasDemo" --query "AtlasDemo next milestone" --budget 8192 --memory-gate balanced --output ./context-pack.md',
  fence,
  "",
].join("\n");
await writeFile("apps/agent-bridge/README.md", readme);
console.log("Agent Bridge built at apps/agent-bridge");
