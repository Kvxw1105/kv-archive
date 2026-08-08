#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openAgentRepository } from "./agent-core.js";
import { createContinuityBenchmark, evaluateContinuityResponse } from "./continuity-benchmark.js";
import { serveMcpStdio } from "./mcp-server.js";
import { writeStateProposal } from "./proposal-core.js";
import { memoryGateManifest, renderMemoryGateMarkdown } from "./memory-gate.js";
import { compareMemoryGateBenchmarkResponses, createMemoryGateBenchmarkExperiment } from "./memory-gate-benchmark.js";
import { BRIDGE_VERSION } from "./version.js";
import { sha256Hex } from "./bundle-builder.js";
import { receiveVerifiedHandoff, verifyHandoffResponse, writeVerifiedHandoffPackages } from "./verified-handoff.js";

function usage() {
  return `KV Archive Agent Bridge v${BRIDGE_VERSION}\n\nUsage:\n  kv-archive-agent serve --bundle <agent-bundle.zip> [--proposal-dir <directory>]\n  kv-archive-agent inspect --bundle <agent-bundle.zip>\n  kv-archive-agent pack --bundle <agent-bundle.zip> --query <text> [--budget 2048|8192|32768] --output <file.md>\n  kv-archive-agent propose --bundle <agent-bundle.zip> --input <proposal-draft.json> [--proposal-dir <directory>]\n  kv-archive-agent benchmark-create --bundle <agent-bundle.zip> --project <id-or-title> --output <directory>\n  kv-archive-agent benchmark-score --bundle <agent-bundle.zip> --benchmark <answer-key.json> --response <response.json> --output <directory>\n  kv-archive-agent benchmark-gate-create --bundle <agent-bundle.zip> --project <id-or-title> --query <text> --output <directory>\n  kv-archive-agent benchmark-gate-score --bundle <agent-bundle.zip> --benchmark <answer-key.json> --response-off <json> --response-on <json> --output <directory>\n  kv-archive-agent handoff-create --bundle <agent-bundle.zip> --project <id-or-title> --query <goal> --output <directory>\n  kv-archive-agent handoff-receive --handoff <receiver-package.zip> --output <directory> [--receiver <name>]\n  kv-archive-agent handoff-verify --handoff <receiver-package.zip> --verification-kit <private-kit.zip> --receiver-receipt <json> --response <json> --output <directory>\n`;
}
function valueAfter(args, flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }

async function writeBenchmarkFiles(repository, args) {
  const project = valueAfter(args, "--project") || valueAfter(args, "--project-id") || valueAfter(args, "--project-title");
  const output = valueAfter(args, "--output");
  if (!project) throw new Error("Missing --project <id-or-title>");
  if (!output) throw new Error("Missing --output <directory>");
  const generatedAt = valueAfter(args, "--generated-at");
  const benchmark = createContinuityBenchmark(repository, { project, ...(generatedAt ? { generatedAt } : {}) });
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  const files = {
    prompt: join(directory, "PROMPT.md"),
    challenge: join(directory, "benchmark-challenge.json"),
    answerKey: join(directory, "benchmark-answer-key.json"),
    responseTemplate: join(directory, "response-template.json"),
  };
  await Promise.all([
    writeFile(files.prompt, benchmark.prompt, "utf8"),
    writeFile(files.challenge, `${JSON.stringify(benchmark.challenge, null, 2)}\n`, "utf8"),
    writeFile(files.answerKey, `${JSON.stringify(benchmark.answerKey, null, 2)}\n`, "utf8"),
    writeFile(files.responseTemplate, `${JSON.stringify(benchmark.responseTemplate, null, 2)}\n`, "utf8"),
  ]);
  console.log(JSON.stringify({ benchmarkId: benchmark.challenge.benchmarkId, project: benchmark.challenge.project, output: directory, files, warning: "Keep benchmark-answer-key.json away from the receiving Agent." }, null, 2));
}


async function writeMemoryGateFiles(repository, args) {
  const project = valueAfter(args, "--project") || valueAfter(args, "--project-id") || valueAfter(args, "--project-title");
  const output = valueAfter(args, "--output");
  if (!project) throw new Error("Missing --project <id-or-title>");
  if (!output) throw new Error("Missing --output <directory>");
  const policy = valueAfter(args, "--policy") || "balanced";
  if (!["safe", "balanced", "broad"].includes(policy)) throw new Error("--policy must be safe, balanced, or broad");
  const tokenBudget = Number(valueAfter(args, "--token-budget") || 2048);
  if (!Number.isFinite(tokenBudget) || tokenBudget < 128) throw new Error("--token-budget must be at least 128");
  const generatedAt = valueAfter(args, "--generated-at");
  const report = repository.runMemoryGate({ project, policy, tokenBudget, ...(generatedAt ? { generatedAt } : {}) });
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  const files = {
    manifest: join(directory, "memory-gate-manifest.json"),
    reportJson: join(directory, "memory-gate-report.json"),
    reportMarkdown: join(directory, "memory-gate-report.md"),
    included: join(directory, "included-memories.json"),
    excluded: join(directory, "excluded-memories.json"),
    review: join(directory, "review-required.json"),
  };
  await Promise.all([
    writeFile(files.manifest, `${JSON.stringify(memoryGateManifest(report), null, 2)}\n`, "utf8"),
    writeFile(files.reportJson, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(files.reportMarkdown, renderMemoryGateMarkdown(report), "utf8"),
    writeFile(files.included, `${JSON.stringify(report.included, null, 2)}\n`, "utf8"),
    writeFile(files.excluded, `${JSON.stringify(report.excluded, null, 2)}\n`, "utf8"),
    writeFile(files.review, `${JSON.stringify(report.reviewRequired, null, 2)}\n`, "utf8"),
  ]);
  console.log(JSON.stringify({ output: directory, projectId: report.projectId, policy: report.policy, counts: report.counts, tokenBudget: report.tokenBudget, usedTokens: report.usedTokens, files }, null, 2));
}

async function scoreBenchmark(repository, args) {
  const benchmarkPath = valueAfter(args, "--benchmark");
  const responsePath = valueAfter(args, "--response");
  const output = valueAfter(args, "--output");
  if (!benchmarkPath) throw new Error("Missing --benchmark <answer-key.json>");
  if (!responsePath) throw new Error("Missing --response <response.json>");
  if (!output) throw new Error("Missing --output <directory>");
  const answerKey = JSON.parse(await readFile(resolve(benchmarkPath), "utf8"));
  const response = JSON.parse(await readFile(resolve(responsePath), "utf8"));
  const result = evaluateContinuityResponse(repository, answerKey, response);
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  const jsonPath = join(directory, "continuity-report.json");
  const markdownPath = join(directory, "continuity-report.md");
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(result.report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, result.markdown, "utf8"),
  ]);
  console.log(JSON.stringify({ output: directory, jsonPath, markdownPath, verdict: result.report.verdict, score: result.report.score, verified: result.report.verified }, null, 2));
}

async function writeGateBenchmarkExperiment(repository, args) {
  const project = valueAfter(args, "--project") || valueAfter(args, "--project-id") || valueAfter(args, "--project-title");
  const output = valueAfter(args, "--output");
  if (!project) throw new Error("Missing --project <id-or-title>");
  if (!output) throw new Error("Missing --output <directory>");
  const experiment = createMemoryGateBenchmarkExperiment(repository, { project, query:valueAfter(args,"--query")||"Continue the current project accurately", budgetTokens:Number(valueAfter(args,"--budget")||8192), gatePolicy:valueAfter(args,"--policy")||"balanced", gateBudgetTokens:Number(valueAfter(args,"--gate-budget")||0)||undefined, generatedAt:valueAfter(args,"--generated-at") });
  const directory = resolve(output);
  await mkdir(directory,{recursive:true});
  const manifest={format:experiment.format,version:experiment.version,experimentId:experiment.experimentId,generatedAt:experiment.generatedAt,project:experiment.project,query:experiment.query,budgetTokens:experiment.budgetTokens,gatePolicy:experiment.gatePolicy,gateBudgetTokens:experiment.gateBudgetTokens,files:{prompt:"PROMPT.md",challenge:"benchmark-challenge.json",answerKey:"benchmark-answer-key.json",packOff:"context-pack-gate-off.md",packOn:"context-pack-gate-on.md",responseOff:"response-gate-off.json",responseOn:"response-gate-on.json"}};
  const instructions=["# Memory Gate paired benchmark","",`Experiment: ${experiment.experimentId}`,"","1. Keep benchmark-answer-key.json private.","2. Give the same receiving Agent PROMPT.md plus context-pack-gate-off.md, then save JSON as response-gate-off.json.","3. Start a fresh receiving-Agent context, give the same PROMPT.md plus context-pack-gate-on.md, then save JSON as response-gate-on.json.","4. Run benchmark-gate-score. Do not edit either response after seeing the answer key.",""].join("\n");
  await Promise.all([
    writeFile(join(directory,"experiment-manifest.json"),`${JSON.stringify(manifest,null,2)}\n`),
    writeFile(join(directory,"RUN_INSTRUCTIONS.md"),instructions),
    writeFile(join(directory,"PROMPT.md"),experiment.benchmark.prompt),
    writeFile(join(directory,"benchmark-challenge.json"),`${JSON.stringify(experiment.benchmark.challenge,null,2)}\n`),
    writeFile(join(directory,"benchmark-answer-key.json"),`${JSON.stringify(experiment.benchmark.answerKey,null,2)}\n`),
    writeFile(join(directory,"context-pack-gate-off.md"),experiment.packs.off.markdown),
    writeFile(join(directory,"context-pack-gate-on.md"),experiment.packs.on.markdown),
    writeFile(join(directory,"response-gate-off.json"),`${JSON.stringify(experiment.benchmark.responseTemplate,null,2)}\n`),
    writeFile(join(directory,"response-gate-on.json"),`${JSON.stringify(experiment.benchmark.responseTemplate,null,2)}\n`),
  ]);
  console.log(JSON.stringify({experimentId:experiment.experimentId,output:directory,gatePolicy:experiment.gatePolicy,offTokens:experiment.packs.off.estimatedTokens,onTokens:experiment.packs.on.estimatedTokens,warning:"Keep benchmark-answer-key.json private."},null,2));
}

async function scoreGateBenchmarkExperiment(repository,args){
  const benchmarkPath=valueAfter(args,"--benchmark"); const responseOffPath=valueAfter(args,"--response-off"); const responseOnPath=valueAfter(args,"--response-on"); const output=valueAfter(args,"--output");
  if(!benchmarkPath)throw new Error("Missing --benchmark <answer-key.json>"); if(!responseOffPath)throw new Error("Missing --response-off <response.json>"); if(!responseOnPath)throw new Error("Missing --response-on <response.json>"); if(!output)throw new Error("Missing --output <directory>");
  const answerKey=JSON.parse(await readFile(resolve(benchmarkPath),"utf8")); const responseOff=JSON.parse(await readFile(resolve(responseOffPath),"utf8")); const responseOn=JSON.parse(await readFile(resolve(responseOnPath),"utf8"));
  const result=compareMemoryGateBenchmarkResponses(repository,answerKey,responseOff,responseOn,{experimentId:valueAfter(args,"--experiment-id")}); const directory=resolve(output); await mkdir(directory,{recursive:true});
  await Promise.all([writeFile(join(directory,"memory-gate-benchmark-comparison.json"),`${JSON.stringify(result.report,null,2)}\n`),writeFile(join(directory,"memory-gate-benchmark-comparison.md"),result.markdown),writeFile(join(directory,"continuity-gate-off-report.json"),`${JSON.stringify(result.offReport,null,2)}\n`),writeFile(join(directory,"continuity-gate-on-report.json"),`${JSON.stringify(result.onReport,null,2)}\n`)]);
  console.log(JSON.stringify({output:directory,off:result.report.off,on:result.report.on,scoreDelta:result.report.scoreDelta,conclusion:result.report.conclusion},null,2));
}


async function createHandoff(repository, args) {
  const project = valueAfter(args, "--project") || valueAfter(args, "--project-id") || valueAfter(args, "--project-title");
  const output = valueAfter(args, "--output");
  if (!project) throw new Error("Missing --project <id-or-title>");
  if (!output) throw new Error("Missing --output <directory>");
  const contextBudget = Number(valueAfter(args, "--budget") || 8192);
  const gatePolicy = valueAfter(args, "--policy") || "balanced";
  const gateBudget = Number(valueAfter(args, "--gate-budget") || Math.min(2048, Math.floor(contextBudget * 0.35)));
  const sourceBundlePath = resolve(valueAfter(args, "--bundle"));
  const sourceBundleSha256 = sha256Hex(new Uint8Array(await readFile(sourceBundlePath)));
  const result = await writeVerifiedHandoffPackages(repository, {
    project,
    sourceBundleSha256,
    query: valueAfter(args, "--query") || "Continue the current project accurately",
    outputDirectory: output,
    contextBudget,
    gatePolicy,
    gateTarget: valueAfter(args, "--target") || "internal",
    gateBudget,
    allowReview: args.includes("--allow-review"),
    allowBudgetOverrun: args.includes("--allow-budget-overrun"),
    generatedAt: valueAfter(args, "--generated-at"),
  });
  console.log(JSON.stringify({
    handoffId: result.handoffId,
    project: result.contract.project,
    status: result.senderReceipt.status,
    receiverPackage: result.files.receiverPath,
    receiverPackageSha256: result.receiver.sha256,
    verificationKit: result.files.verificationKitPath,
    verificationKitSha256: result.verificationKit.sha256,
    senderReceipt: result.files.detachedReceiptPath,
    warning: "Send only the receiver package. Keep the verification kit private.",
  }, null, 2));
}

async function receiveHandoff(args) {
  const handoff = valueAfter(args, "--handoff");
  const output = valueAfter(args, "--output");
  if (!handoff) throw new Error("Missing --handoff <receiver-package.zip>");
  if (!output) throw new Error("Missing --output <directory>");
  const result = await receiveVerifiedHandoff(handoff, output, { receiver: valueAfter(args, "--receiver"), generatedAt: valueAfter(args, "--generated-at") });
  console.log(JSON.stringify({ handoffId: result.receipt.handoffId, status: result.receipt.status, output: result.output, receiverReceipt: result.files.receiverReceipt, files: result.files }, null, 2));
}

async function verifyHandoff(args) {
  const handoffPath = valueAfter(args, "--handoff");
  const verificationKitPath = valueAfter(args, "--verification-kit");
  const receiverReceiptPath = valueAfter(args, "--receiver-receipt");
  const responsePath = valueAfter(args, "--response");
  const outputDirectory = valueAfter(args, "--output");
  if (!handoffPath) throw new Error("Missing --handoff <receiver-package.zip>");
  if (!verificationKitPath) throw new Error("Missing --verification-kit <private-kit.zip>");
  if (!receiverReceiptPath) throw new Error("Missing --receiver-receipt <json>");
  if (!responsePath) throw new Error("Missing --response <json>");
  if (!outputDirectory) throw new Error("Missing --output <directory>");
  const result = await verifyHandoffResponse({ handoffPath, verificationKitPath, receiverReceiptPath, responsePath, outputDirectory, generatedAt: valueAfter(args, "--generated-at") });
  console.log(JSON.stringify({ handoffId: result.report.handoffId, status: result.report.status, score: result.report.continuity?.score ?? null, verdict: result.report.continuity?.verdict || null, files: result.files }, null, 2));
}

export async function runAgentCli(args = process.argv.slice(2)) {
  const command = args[0];
  if (!command) throw new Error(usage());
  if (command === "handoff-receive") { await receiveHandoff(args); return; }
  if (command === "handoff-verify") { await verifyHandoff(args); return; }
  const bundle = valueAfter(args, "--bundle");
  if (!bundle) throw new Error(usage());
  const proposalDir = valueAfter(args, "--proposal-dir") || "./kv-archive-proposals";
  if (command === "serve") { await serveMcpStdio(resolve(bundle), { proposalDir, client: "mcp" }); return; }
  const repository = await openAgentRepository(resolve(bundle));
  if (command === "inspect") { console.log(JSON.stringify({ stats: repository.stats(), projects: repository.listProjects() }, null, 2)); return; }
  if (command === "pack") {
    const query = valueAfter(args, "--query") || "";
    const projectId = valueAfter(args, "--project-id");
    const projectTitle = valueAfter(args, "--project-title");
    const output = valueAfter(args, "--output");
    if (!output) throw new Error("Missing --output <file.md>");
    const budget = Number(valueAfter(args, "--budget") || 8192);
    if (![2048, 8192, 32768].includes(budget)) throw new Error("--budget must be 2048, 8192, or 32768");
    const memoryGatePolicy = valueAfter(args, "--memory-gate");
    if (memoryGatePolicy && !["safe", "balanced", "broad"].includes(memoryGatePolicy)) throw new Error("--memory-gate must be safe, balanced, or broad");
    const pack = repository.buildContextPack({ query, projectId, projectTitle, budgetTokens: budget, ...(memoryGatePolicy ? { memoryGatePolicy } : {}) });
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(resolve(output), pack.markdown, "utf8");
    console.log(JSON.stringify({ output: resolve(output), estimatedTokens: pack.estimatedTokens, sources: pack.selectedExcerpts, truncated: pack.truncated }, null, 2));
    return;
  }
  if (command === "propose") {
    const input = valueAfter(args, "--input");
    if (!input) throw new Error("Missing --input <proposal-draft.json>");
    const draft = JSON.parse(await readFile(resolve(input), "utf8"));
    const result = await writeStateProposal(repository, draft, { outputDir: proposalDir, client: "cli" });
    console.log(JSON.stringify({ proposalPath: result.path, proposalId: result.proposal.id, projectId: result.proposal.projectId, baseVersion: result.proposal.baseVersion, approvalRequired: true }, null, 2));
    return;
  }
  if (command === "memory-gate") { await writeMemoryGateFiles(repository, args); return; }
  if (command === "benchmark-create") { await writeBenchmarkFiles(repository, args); return; }
  if (command === "benchmark-score") { await scoreBenchmark(repository, args); return; }
  if (command === "benchmark-gate-create") { await writeGateBenchmarkExperiment(repository, args); return; }
  if (command === "benchmark-gate-score") { await scoreGateBenchmarkExperiment(repository, args); return; }
  if (command === "handoff-create") { await createHandoff(repository, args); return; }
  throw new Error(usage());
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runAgentCli().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
