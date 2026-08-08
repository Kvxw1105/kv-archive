#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalConversation } from "../../../packages/domain/src/index.js";
import { normalizeChatGPTConversation } from "../../../packages/normalizer/src/index.js";
import { renderActivePathMarkdown } from "../../../packages/renderers/src/index.js";
import { generateIntegrityReport } from "../../../packages/integrity/src/index.js";

interface ParsedArguments {
  command: string;
  inputPath: string;
  outputPath: string;
}

const usage = `ContextVault MVP\n\nUsage:\n  context-vault normalize <input.json> --output <directory>\n`;

function parseArguments(argv: string[]): ParsedArguments {
  const [command, inputPath, ...rest] = argv;
  if (command !== "normalize" || !inputPath) throw new Error(usage);
  const outputFlag = rest.indexOf("--output");
  const outputPath = outputFlag >= 0 ? rest[outputFlag + 1] : null;
  if (!outputPath) throw new Error("Missing --output <directory>\n\n" + usage);
  return { command, inputPath, outputPath };
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  const inputAbsolute = resolve(args.inputPath);
  const outputAbsolute = resolve(args.outputPath);
  const rawText = await readFile(inputAbsolute, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const canonical = normalizeChatGPTConversation(raw, { adapter: "cli-import", sourceUrl: null });
  assertCanonicalConversation(canonical);
  const markdown = renderActivePathMarkdown(canonical);
  const report = generateIntegrityReport(canonical);

  await mkdir(outputAbsolute, { recursive: true });
  await Promise.all([
    writeFile(resolve(outputAbsolute, "raw.json"), JSON.stringify(raw, null, 2) + "\n", "utf8"),
    writeFile(resolve(outputAbsolute, "canonical.json"), JSON.stringify(canonical, null, 2) + "\n", "utf8"),
    writeFile(resolve(outputAbsolute, "conversation.md"), markdown, "utf8"),
    writeFile(resolve(outputAbsolute, "integrity-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8"),
  ]);

  console.log(`ContextVault normalized ${canonical.conversationId}`);
  console.log(`Integrity status: ${report.status}`);
  console.log(`Output: ${outputAbsolute}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
