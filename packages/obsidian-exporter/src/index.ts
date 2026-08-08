import type {
  KnowledgeEdge,
  KnowledgeGraphIR,
  KnowledgeNode,
  KnowledgeNodeKind,
  KnowledgePropertyValue,
  KnowledgeRelation,
} from "../../knowledge-graph/src/index.js";

export interface ObsidianPathRecord {
  nodeId: string;
  path: string;
  sourceHash: string;
  allocatedAt: string;
  updatedAt: string;
}

export type ObsidianPathMap = Record<string, ObsidianPathRecord>;

export interface ObsidianVaultEntry {
  path: string;
  data: string | Uint8Array;
  nodeId?: string;
  kind: "markdown" | "canvas" | "json" | "asset";
  sourceHash?: string;
}

export interface ObsidianCanvasNode {
  id: string;
  type: "file" | "text" | "group" | "link";
  x: number;
  y: number;
  width: number;
  height: number;
  file?: string;
  text?: string;
  label?: string;
  color?: string;
}

export interface ObsidianCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toSide?: "top" | "right" | "bottom" | "left";
  label?: string;
  color?: string;
}

export interface ObsidianCanvasDocument {
  nodes: ObsidianCanvasNode[];
  edges: ObsidianCanvasEdge[];
}

export interface ObsidianVaultManifest {
  format: "context-vault-obsidian-vault";
  version: 1;
  generatedAt: string;
  projectId: string;
  graphHash: string;
  canvasPath: string;
  files: Array<{
    path: string;
    nodeId: string | null;
    kind: ObsidianVaultEntry["kind"];
    sourceHash: string | null;
  }>;
  pathMap: ObsidianPathMap;
}

export interface ObsidianVaultReport {
  status: "COMPLETE" | "PARTIAL" | "FAILED";
  projectId: string;
  graphHash: string;
  nodeCount: number;
  edgeCount: number;
  markdownFiles: number;
  canvasNodes: number;
  canvasEdges: number;
  reusedPaths: number;
  allocatedPaths: number;
  removedPaths: string[];
  duplicatePaths: string[];
  brokenLinks: string[];
  invalidCanvasReferences: string[];
  orphanNodeIds: string[];
}

export interface RenderObsidianVaultOptions {
  generatedAt?: string;
  previousPathMap?: ObsidianPathMap;
  includeGuide?: boolean;
  canvasNodeLimit?: number;
  materializedAssetNodeIds?: Iterable<string>;
}

export interface ObsidianVaultPlan {
  entries: ObsidianVaultEntry[];
  manifest: ObsidianVaultManifest;
  report: ObsidianVaultReport;
  pathMap: ObsidianPathMap;
  canvas: ObsidianCanvasDocument;
}

const DIRECTORY_BY_KIND: Record<KnowledgeNodeKind, string> = {
  project: "10 Projects",
  conversation: "20 Conversations",
  decision: "30 Decisions",
  task: "40 Tasks",
  memory: "50 Memories",
  evidence: "60 Evidence",
  content: "70 Content",
  asset: "90 Attachments",
};

const TAG_BY_KIND: Record<KnowledgeNodeKind, string> = {
  project: "contextvault/project",
  conversation: "contextvault/conversation",
  decision: "contextvault/decision",
  task: "contextvault/task",
  memory: "contextvault/memory",
  evidence: "contextvault/evidence",
  content: "contextvault/content",
  asset: "contextvault/asset",
};

const encoder = new TextEncoder();

const clean = (value: unknown, max = 100_000): string =>
  String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function sanitizeObsidianFilename(value: unknown, maxLength = 100): string {
  let text = clean(value, maxLength * 4)
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!text || windowsReserved.test(text)) text = text ? `_${text}` : "Untitled";
  const chars = [...text];
  if (chars.length > maxLength) text = chars.slice(0, maxLength).join("").replace(/[. ]+$/g, "");
  return text || "Untitled";
}

const preferredBasename = (node: KnowledgeNode): string => {
  const title = sanitizeObsidianFilename(node.title, 86);
  return `${title}__${fnv1a(node.id)}`;
};

const assetPathForNode = (node: KnowledgeNode): string => {
  const safe = sanitizeObsidianFilename(node.title, 120);
  const match = safe.match(/^(.*?)(\.[A-Za-z0-9]{1,12})$/);
  const stem = sanitizeObsidianFilename(match?.[1] || safe, 92);
  const extension = match?.[2] || "";
  return `${DIRECTORY_BY_KIND.asset}/${stem}__${fnv1a(node.id)}${extension}`;
};

const pathForNode = (node: KnowledgeNode): string =>
  node.kind === "asset"
    ? assetPathForNode(node)
    : `${DIRECTORY_BY_KIND[node.kind]}/${preferredBasename(node)}.md`;

const isManagedPathForNode = (node: KnowledgeNode, path: string): boolean =>
  node.kind === "asset"
    ? /^90 Attachments\/.+/i.test(path)
    : /^(10 Projects|20 Conversations|30 Decisions|40 Tasks|50 Memories|60 Evidence)\/.+\.md$/i.test(path);

export function allocateObsidianPaths(
  graph: KnowledgeGraphIR,
  previousPathMap: ObsidianPathMap = {},
  now = graph.generatedAt,
  materializedAssetNodeIds: Iterable<string> = [],
): { pathMap: ObsidianPathMap; reusedPaths: number; allocatedPaths: number; removedPaths: string[] } {
  const pathMap: ObsidianPathMap = {};
  const used = new Set<string>();
  const materializedAssets = new Set(materializedAssetNodeIds);
  let reusedPaths = 0;
  let allocatedPaths = 0;

  for (const node of graph.nodes) {
    if (node.kind === "asset" && !materializedAssets.has(node.id)) continue;
    const previous = previousPathMap[node.id];
    let path = previous?.path && isManagedPathForNode(node, previous.path) && !used.has(previous.path)
      ? previous.path
      : pathForNode(node);
    if (used.has(path)) {
      const base = path.replace(/\.md$/i, "");
      let index = 2;
      while (used.has(`${base}-${index}.md`)) index += 1;
      path = `${base}-${index}.md`;
    }
    used.add(path);
    const reused = previous?.path === path;
    if (reused) reusedPaths += 1;
    else allocatedPaths += 1;
    pathMap[node.id] = {
      nodeId: node.id,
      path,
      sourceHash: node.sourceHash,
      allocatedAt: reused ? previous.allocatedAt : now,
      updatedAt: now,
    };
  }

  const currentIds = new Set(Object.keys(pathMap));
  const removedPaths = Object.values(previousPathMap)
    .filter((record) => !currentIds.has(record.nodeId))
    .map((record) => record.path)
    .sort();
  return { pathMap, reusedPaths, allocatedPaths, removedPaths };
}

const yamlScalar = (value: string | number | boolean | null): string => {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

const yamlKey = (value: string): string => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)
  ? value
  : JSON.stringify(value);

export function renderFlatYaml(properties: Record<string, KnowledgePropertyValue>): string {
  const lines = ["---"];
  for (const key of Object.keys(properties).sort()) {
    const value = properties[key];
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${yamlKey(key)}: []`);
      else {
        lines.push(`${yamlKey(key)}:`);
        for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
      }
    } else {
      lines.push(`${yamlKey(key)}: ${yamlScalar(value ?? null)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

const wikiLink = (path: string, title?: string): string => {
  const target = path.replace(/\.md$/i, "");
  return title && title !== target ? `[[${target}|${title}]]` : `[[${target}]]`;
};

const relationLabel = (relation: KnowledgeRelation): string => ({
  belongs_to: "belongs to",
  supports: "supports",
  derived_from: "derived from",
  depends_on: "depends on",
  supersedes: "supersedes",
  summarizes: "summarizes",
  references: "references",
  related_to: "related to",
  contains: "contains",
  promoted_to: "promoted to",
})[relation];

const renderConnections = (
  node: KnowledgeNode,
  graph: KnowledgeGraphIR,
  nodeById: Map<string, KnowledgeNode>,
  pathMap: ObsidianPathMap,
): string => {
  const outgoing = graph.edges.filter((edge) => edge.from === node.id);
  const incoming = graph.edges.filter((edge) => edge.to === node.id);
  const lines: string[] = [];
  for (const edge of outgoing) {
    const target = nodeById.get(edge.to);
    const path = pathMap[edge.to]?.path;
    if (!target || !path) continue;
    lines.push(`- ${relationLabel(edge.relation)} → ${wikiLink(path, target.title)}${edge.evidenceUri ? ` — \`${edge.evidenceUri}\`` : ""}`);
  }
  for (const edge of incoming) {
    const source = nodeById.get(edge.from);
    const path = pathMap[edge.from]?.path;
    if (!source || !path) continue;
    lines.push(`- ← ${relationLabel(edge.relation)} — ${wikiLink(path, source.title)}${edge.evidenceUri ? ` — \`${edge.evidenceUri}\`` : ""}`);
  }
  return lines.length ? ["## Connections", "", ...unique(lines)].join("\n") : "";
}

export function renderObsidianNodeMarkdown(
  node: KnowledgeNode,
  graph: KnowledgeGraphIR,
  pathMap: ObsidianPathMap,
  options: { bodyOverride?: string | null } = {},
): string {
  const nodeById = new Map(graph.nodes.map((item) => [item.id, item]));
  const projectNode = graph.nodes.find((item) => item.kind === "project");
  const projectPath = projectNode ? pathMap[projectNode.id]?.path : undefined;
  const outgoing = graph.edges.filter((edge) => edge.from === node.id);
  const linkedIds = unique(outgoing.map((edge) => edge.to));
  const linkValues = linkedIds
    .map((id) => {
      const target = nodeById.get(id);
      const targetPath = pathMap[id]?.path;
      return target && targetPath ? wikiLink(targetPath, target.title) : null;
    })
    .filter((value): value is string => Boolean(value));
  const properties: Record<string, KnowledgePropertyValue> = {
    contextvault_id: node.id,
    contextvault_type: node.kind,
    contextvault_schema: graph.schemaVersion,
    contextvault_managed: true,
    source_hash: node.sourceHash,
    graph_hash: graph.graphHash,
    project_id: graph.projectId,
    project: projectPath && projectNode ? wikiLink(projectPath, projectNode.title) : null,
    evidence_uris: node.evidenceUris,
    links: linkValues,
    tags: [TAG_BY_KIND[node.kind]],
    ...node.properties,
  };
  const renderedBody = options.bodyOverride === undefined ? node.body : clean(options.bodyOverride, 10_000_000);
  const sourceBlock = node.evidenceUris.length
    ? ["> [!info] ContextVault evidence", ...node.evidenceUris.map((uri) => `> - \`${uri}\``)].join("\n")
    : "> [!info] ContextVault source\n> This note is generated from the local ContextVault evidence and derived-state layers.";
  const connections = renderConnections(node, graph, nodeById, pathMap);
  return [
    renderFlatYaml(properties),
    "",
    `# ${node.title}`,
    "",
    sourceBlock,
    renderedBody ? `\n${renderedBody}` : "",
    connections ? `\n${connections}` : "",
    "",
  ].join("\n").replace(/\n{4,}/g, "\n\n\n");
}

const sortByTitle = (nodes: KnowledgeNode[]): KnowledgeNode[] =>
  [...nodes].sort((left, right) => left.title.localeCompare(right.title, "zh-CN") || left.id.localeCompare(right.id));

const listLinks = (nodes: KnowledgeNode[], pathMap: ObsidianPathMap): string[] =>
  sortByTitle(nodes).map((node) => `- ${wikiLink(pathMap[node.id]!.path, node.title)}`);

const renderProjectMoc = (graph: KnowledgeGraphIR, pathMap: ObsidianPathMap): string => {
  const groups: Array<[string, KnowledgeNodeKind]> = [
    ["Memories", "memory"],
    ["Decisions", "decision"],
    ["Tasks", "task"],
    ["Content", "content"],
    ["Conversations", "conversation"],
    ["Evidence", "evidence"],
  ];
  const project = graph.nodes.find((node) => node.kind === "project");
  const sections: string[] = [];
  for (const [title, kind] of groups) {
    const nodes = graph.nodes.filter((node) => node.kind === kind);
    sections.push(`## ${title}`, "", ...(nodes.length ? listLinks(nodes, pathMap) : ["- None"]), "");
  }
  return [
    "---",
    "contextvault_managed: true",
    "contextvault_type: moc",
    `project_id: ${yamlScalar(graph.projectId)}`,
    `graph_hash: ${yamlScalar(graph.graphHash)}`,
    "tags:",
    "  - \"contextvault/moc\"",
    "---",
    "",
    `# ${project?.title ?? graph.projectId} · Project Map`,
    "",
    project ? `Project: ${wikiLink(pathMap[project.id]!.path, project.title)}` : "",
    "",
    ...sections,
  ].join("\n");
};

const projectTitleFromGraph = (graph: KnowledgeGraphIR): string =>
  graph.nodes.find((node) => node.kind === "project")?.title ?? graph.projectId;

const recommendedImportRoot = (graph: KnowledgeGraphIR): string =>
  `KV Archive/${sanitizeObsidianFilename(projectTitleFromGraph(graph), 70)}`;

const renderHome = (graph: KnowledgeGraphIR, pathMap: ObsidianPathMap, canvasPath: string, includeGuide: boolean): string => {
  const project = graph.nodes.find((node) => node.kind === "project");
  const counts = Object.fromEntries(Object.keys(DIRECTORY_BY_KIND).map((kind) => [kind, graph.nodes.filter((node) => node.kind === kind).length]));
  return [
    "---",
    "contextvault_managed: true",
    "contextvault_type: home",
    `project_id: ${yamlScalar(graph.projectId)}`,
    `graph_hash: ${yamlScalar(graph.graphHash)}`,
    "tags:",
    "  - \"kv-archive/home\"",
    "---",
    "",
    "# KV Archive Home",
    "",
    "> 第一次使用请先打开 [[00 Home/START_HERE|START HERE]]。",
    "",
    project ? `## Project\n\n- ${wikiLink(pathMap[project.id]!.path, project.title)}` : "",
    "",
    "## Open",
    "",
    `- [[${canvasPath}|Curated Project Canvas]]`,
    "- [[00 Home/Project MOC|Project MOC]]",
    "- [[00 Home/START_HERE|新手导入说明]]",
    "- [[00 Home/IMPORT_OPTIONS|导入方式选择]]",
    "- [[00 Home/AGENT_PROMPT|交给本地 Agent]]",
    ...(includeGuide ? ["- [[00 Home/Export Guide|Export Guide]]"] : []),
    "",
    "## Graph summary",
    "",
    ...Object.entries(counts).map(([kind, count]) => `- ${kind}: ${count}`),
    `- relations: ${graph.edges.length}`,
    "",
  ].join("\n");
};

const renderStartHere = (graph: KnowledgeGraphIR): string => [
  "---",
  "contextvault_managed: true",
  "contextvault_type: start_here",
  "tags:",
  "  - \"kv-archive/guide\"",
  "---",
  "",
  "# 从这里开始",
  "",
  `这个压缩包是 **${projectTitleFromGraph(graph)}** 的 KV Archive Obsidian 知识库。`,
  "",
  "你有三种使用方式：",
  "",
  "1. **第一次使用 Obsidian**：把全部 ZIP 分卷解压到同一个新文件夹，然后在 Obsidian 中选择“打开文件夹作为仓库”。",
  `2. **已有自己的 Obsidian 库**：把本项目整体放到 \`${recommendedImportRoot(graph)}\`，不要把文件散落在库根目录。`,
  "3. **交给本地 AI Agent**：复制 [[00 Home/AGENT_PROMPT|AGENT PROMPT]]，把 ZIP 路径填进去后交给具备本地文件能力的 Agent。",
  "",
  "## 打开后先看",
  "",
  "- [[00 Home/KV Archive Home|KV Archive Home]]",
  "- [[00 Home/Project MOC|Project MOC]]",
  "- [[80 Canvas/Project Map.canvas|Project Map Canvas]]",
  "",
  "> 多个分卷必须解压到同一个目录。不要分别建立多个 Vault。",
  "",
].join("\n");

const renderImportOptions = (graph: KnowledgeGraphIR): string => [
  "---",
  "contextvault_managed: true",
  "contextvault_type: import_options",
  "tags:",
  "  - \"kv-archive/guide\"",
  "---",
  "",
  "# 导入方式",
  "",
  "## A. 新建独立 Vault",
  "",
  "适合第一次体验、希望与已有笔记完全隔离，或准备把本项目单独交给 Agent 的用户。把所有分卷合并解压到一个新文件夹，再让 Obsidian 打开该文件夹。",
  "",
  "## B. 放入已有 Vault",
  "",
  `推荐目标目录：\`${recommendedImportRoot(graph)}\`。`,
  "",
  "导入时必须遵守：",
  "",
  "- 不覆盖已有 `.obsidian` 配置；",
  "- 不覆盖已有笔记；",
  "- 同名冲突先报告，必要时放入 `_Conflicts`；",
  "- 写入前生成计划，写入后生成导入收据；",
  "- 删除或回滚时只处理收据记录的本次新增文件。",
  "",
  "## C. 只检查，不导入",
  "",
  "可以让 Agent 只解压到临时目录，检查文件数量、附件、坏链接、Canvas 引用和目标路径冲突，不修改任何 Vault。",
  "",
].join("\n");

const renderAgentPrompt = (graph: KnowledgeGraphIR): string => [
  "---",
  "contextvault_managed: true",
  "contextvault_type: agent_prompt",
  "tags:",
  "  - \"kv-archive/agent-handoff\"",
  "---",
  "",
  "# 复制给本地 Agent",
  "",
  "```text",
  "你现在负责安全接管一个 KV Archive Obsidian 导入包。",
  "",
  "压缩包或分卷路径：<把本地路径填写在这里>",
  `项目：${projectTitleFromGraph(graph)}`,
  `推荐导入子目录：${recommendedImportRoot(graph)}`,
  "",
  "先不要修改任何现有文件。请先完成只读预检：",
  "1. 检查所有 ZIP 分卷是否齐全，并解压到临时目录；",
  "2. 读取 99 System/kv-import-manifest.json、export-report.json 和 path-map.json；",
  "3. 检测 Obsidian、官方 CLI（如有）和候选 Vault；",
  "4. 统计 Markdown、Canvas、附件与总大小；",
  "5. 检查坏 Wiki Links、无效 Canvas 文件引用、路径冲突与同名文件；",
  "6. 告诉我可以选择：A 新建独立 Vault，B 导入已有 Vault，C 只看报告。",
  "",
  "得到我确认后再写入。导入已有 Vault 时：",
  "- 只能写入确认过的 KV Archive/<项目名> 子目录；",
  "- 不得覆盖 .obsidian、已有笔记或附件；",
  "- 不得静默安装软件、启用 CLI、修改 PATH 或取得管理员权限；",
  "- 冲突必须停止或放入 _Conflicts 并报告；",
  "- 写入后验证入口笔记、Wiki Links、Canvas 与附件；",
  "- 按 kv-import-receipt.template.json 生成真实导入收据，支持回滚。",
  "",
  "最终只报告：目标 Vault、导入目录、成功/失败计数、冲突、未解析链接、收据路径和已打开的入口文件。",
  "```",
  "",
].join("\n");

const renderAgentHandoff = (graph: KnowledgeGraphIR): string => [
  "# KV Archive Obsidian Agent Handoff",
  "",
  `Project: ${projectTitleFromGraph(graph)}`,
  `Project ID: ${graph.projectId}`,
  `Graph hash: ${graph.graphHash}`,
  `Recommended root: ${recommendedImportRoot(graph)}`,
  "",
  "## Safety contract",
  "",
  "1. Preflight is read-only.",
  "2. Require an explicit destination choice before writing.",
  "3. Never overwrite `.obsidian`, existing notes, attachments, or user configuration.",
  "4. Never install software, enable a CLI, modify PATH, elevate privileges, or delete files without explicit authorization.",
  "5. Keep all imported content under one project namespace.",
  "6. Produce and retain an import receipt before claiming completion.",
  "7. Validate Wiki Links, Canvas file references, entry files, and copied attachment counts.",
  "8. If validation is incomplete, report PARTIAL rather than success.",
  "",
  "## Capability order",
  "",
  "Use official Obsidian CLI when already available; otherwise use safe filesystem operations. Obsidian CLI is an enhancement, not a prerequisite. Fall back to manual instructions when local write access is unavailable.",
  "",
].join("\n");

const renderGuide = (): string => [
  "---",
  "contextvault_managed: true",
  "contextvault_type: guide",
  "tags:",
  "  - \"kv-archive/guide\"",
  "---",
  "",
  "# Export Guide",
  "",
  "1. 第一次使用先打开 `00 Home/START_HERE.md`。",
  "2. Graph View 展示完整关系网；`80 Canvas/Project Map.canvas` 展示整理后的核心项目地图。",
  "3. `contextvault_managed: true` 仅表示该文件由 KV Archive 管理，不代表会自动覆盖用户笔记。",
  "4. 原始证据仍保留在 KV Archive 本地资料库；本 Vault 默认以阅读和项目关系为主，不写入工具日志与模型内部事件。",
  "5. 导入已有 Vault 时使用项目命名空间，并保留导入收据。",
  "",
].join("\n");

const buildImportManifest = (graph: KnowledgeGraphIR, entries: ObsidianVaultEntry[], canvasPath: string, generatedAt: string) => {
  const fileCounts = {
    markdown: entries.filter((entry) => entry.kind === "markdown").length,
    canvas: entries.filter((entry) => entry.kind === "canvas").length,
    json: entries.filter((entry) => entry.kind === "json").length + 3,
    assets: entries.filter((entry) => entry.kind === "asset").length,
  };
  return ({
  format: "kv-archive-obsidian-import-bundle",
  version: 1,
  generatedAt,
  projectId: graph.projectId,
  projectTitle: projectTitleFromGraph(graph),
  graphHash: graph.graphHash,
  entryFile: "00 Home/START_HERE.md",
  homeFile: "00 Home/KV Archive Home.md",
  canvasFile: canvasPath,
  recommendedRoot: recommendedImportRoot(graph),
  containsObsidianConfig: false,
  fileCounts,
  expectedFiles: Object.values(fileCounts).reduce((total, count) => total + count, 0),
  safety: {
    preflightReadOnly: true,
    overwriteExistingFiles: false,
    overwriteObsidianConfig: false,
    requireDestinationConfirmation: true,
    requireImportReceipt: true,
  },
  });
};

const buildReceiptTemplate = (graph: KnowledgeGraphIR) => ({
  format: "kv-archive-obsidian-import-receipt",
  version: 1,
  status: "PLANNED",
  projectId: graph.projectId,
  projectTitle: projectTitleFromGraph(graph),
  sourceBundle: null,
  destinationVault: null,
  destinationRoot: recommendedImportRoot(graph),
  startedAt: null,
  completedAt: null,
  createdFiles: [],
  skippedFiles: [],
  conflicts: [],
  validation: {
    entryFileOpened: false,
    brokenWikiLinks: null,
    invalidCanvasReferences: null,
    expectedFiles: null,
    copiedFiles: null,
  },
  rollback: {
    allowed: true,
    deleteOnlyCreatedFiles: true,
  },
});

const canvasFileNode = (
  node: KnowledgeNode,
  path: string,
  x: number,
  y: number,
  width = 360,
  height = 220,
): ObsidianCanvasNode => ({
  id: `canvas-${fnv1a(node.id)}`,
  type: "file",
  file: path,
  x,
  y,
  width,
  height,
});

const edgeSides = (from: KnowledgeNodeKind, to: KnowledgeNodeKind): Pick<ObsidianCanvasEdge, "fromSide" | "toSide"> => {
  if (from === "memory") return { fromSide: "bottom", toSide: "top" };
  if (from === "decision") return { fromSide: "right", toSide: "left" };
  if (from === "task") return { fromSide: "left", toSide: "right" };
  if (from === "conversation") return { fromSide: "top", toSide: "bottom" };
  return { fromSide: "right", toSide: "left" };
};

export function renderProjectCanvas(
  graph: KnowledgeGraphIR,
  pathMap: ObsidianPathMap,
  nodeLimit = 36,
): ObsidianCanvasDocument {
  const project = graph.nodes.find((node) => node.kind === "project");
  if (!project) return { nodes: [], edges: [] };
  const memories = sortByTitle(graph.nodes.filter((node) => node.kind === "memory")).slice(0, 4);
  const decisions = sortByTitle(graph.nodes.filter((node) => node.kind === "decision" && node.properties.status !== "superseded")).slice(0, 8);
  const tasks = sortByTitle(graph.nodes.filter((node) => node.kind === "task" && !["done", "cancelled", "superseded"].includes(String(node.properties.status)))).slice(0, 8);
  const conversations = [...graph.nodes.filter((node) => node.kind === "conversation")]
    .sort((left, right) => String(right.properties.updated_at ?? "").localeCompare(String(left.properties.updated_at ?? "")) || left.id.localeCompare(right.id))
    .slice(0, 12);
  const selected = [project, ...memories, ...decisions, ...tasks, ...conversations].slice(0, Math.max(1, nodeLimit));
  const selectedIds = new Set(selected.map((node) => node.id));
  const nodes: ObsidianCanvasNode[] = [];
  const byGraphId = new Map<string, ObsidianCanvasNode>();

  const placeRow = (rows: KnowledgeNode[], startX: number, y: number, step: number): void => {
    rows.forEach((node, index) => {
      const file = canvasFileNode(node, pathMap[node.id]!.path, startX + index * step, y);
      nodes.push(file);
      byGraphId.set(node.id, file);
    });
  };
  const projectCanvas = canvasFileNode(project, pathMap[project.id]!.path, 0, 0, 420, 260);
  nodes.push(projectCanvas);
  byGraphId.set(project.id, projectCanvas);
  placeRow(memories.filter((node) => selectedIds.has(node.id)), -500, -420, 420);
  placeRow(decisions.filter((node) => selectedIds.has(node.id)), -1080, 0, 400);
  placeRow(tasks.filter((node) => selectedIds.has(node.id)), 520, 0, 400);
  placeRow(conversations.filter((node) => selectedIds.has(node.id)), -920, 420, 390);

  const edges: ObsidianCanvasEdge[] = [];
  for (const edge of graph.edges) {
    const from = byGraphId.get(edge.from);
    const to = byGraphId.get(edge.to);
    if (!from || !to) continue;
    const fromNode = graph.nodes.find((node) => node.id === edge.from);
    const toNode = graph.nodes.find((node) => node.id === edge.to);
    if (!fromNode || !toNode) continue;
    edges.push({
      id: `canvas-edge-${fnv1a(edge.id)}`,
      fromNode: from.id,
      toNode: to.id,
      label: relationLabel(edge.relation),
      ...edgeSides(fromNode.kind, toNode.kind),
    });
  }
  return {
    nodes: [...nodes].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

const extractWikiTargets = (content: string): string[] => {
  const targets: string[] = [];
  for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = clean(match[1]);
    if (target) targets.push(target);
  }
  return targets;
};

export function validateObsidianVaultEntries(
  entries: ObsidianVaultEntry[],
  canvas: ObsidianCanvasDocument,
): { duplicatePaths: string[]; brokenLinks: string[]; invalidCanvasReferences: string[] } {
  const pathCounts = new Map<string, number>();
  for (const entry of entries) pathCounts.set(entry.path, (pathCounts.get(entry.path) ?? 0) + 1);
  const duplicatePaths = [...pathCounts.entries()].filter(([, count]) => count > 1).map(([path]) => path).sort();
  const entryPaths = new Set(entries.map((entry) => entry.path));
  const markdownTargets = new Set(entries.filter((entry) => entry.kind === "markdown").map((entry) => entry.path.replace(/\.md$/i, "")));
  const attachmentTargets = new Set(entries.filter((entry) => entry.kind === "asset").map((entry) => entry.path));
  const brokenLinks: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== "markdown" || typeof entry.data !== "string") continue;
    for (const target of extractWikiTargets(entry.data)) {
      if (target.endsWith(".canvas")) {
        if (!entryPaths.has(target)) brokenLinks.push(`${entry.path} -> ${target}`);
      } else if (!markdownTargets.has(target) && !attachmentTargets.has(target)) {
        brokenLinks.push(`${entry.path} -> ${target}`);
      }
    }
  }
  const invalidCanvasReferences = canvas.nodes
    .filter((node) => node.type === "file" && (!node.file || !entryPaths.has(node.file)))
    .map((node) => `${node.id} -> ${node.file ?? "missing"}`)
    .sort();
  return {
    duplicatePaths,
    brokenLinks: unique(brokenLinks).sort(),
    invalidCanvasReferences,
  };
}

export function renderObsidianVault(
  graph: KnowledgeGraphIR,
  options: RenderObsidianVaultOptions = {},
): ObsidianVaultPlan {
  const generatedAt = options.generatedAt ?? graph.generatedAt;
  const materializedAssetNodeIds = new Set(options.materializedAssetNodeIds ?? []);
  const allocation = allocateObsidianPaths(graph, options.previousPathMap ?? {}, generatedAt, materializedAssetNodeIds);
  const pathMap = allocation.pathMap;
  const canvasPath = "80 Canvas/Project Map.canvas";
  const entries: ObsidianVaultEntry[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "asset") {
      if (materializedAssetNodeIds.has(node.id) && pathMap[node.id]) {
        entries.push({
          path: pathMap[node.id]!.path,
          data: new Uint8Array(),
          nodeId: node.id,
          kind: "asset",
          sourceHash: node.sourceHash,
        });
      }
      continue;
    }
    entries.push({
      path: pathMap[node.id]!.path,
      data: renderObsidianNodeMarkdown(node, graph, pathMap),
      nodeId: node.id,
      kind: "markdown",
      sourceHash: node.sourceHash,
    });
  }
  entries.push({ path: "00 Home/KV Archive Home.md", data: renderHome(graph, pathMap, canvasPath, options.includeGuide !== false), kind: "markdown" });
  entries.push({ path: "00 Home/Project MOC.md", data: renderProjectMoc(graph, pathMap), kind: "markdown" });
  entries.push({ path: "00 Home/START_HERE.md", data: renderStartHere(graph), kind: "markdown" });
  entries.push({ path: "00 Home/IMPORT_OPTIONS.md", data: renderImportOptions(graph), kind: "markdown" });
  entries.push({ path: "00 Home/AGENT_PROMPT.md", data: renderAgentPrompt(graph), kind: "markdown" });
  entries.push({ path: "99 System/AGENT_HANDOFF.md", data: renderAgentHandoff(graph), kind: "markdown" });
  if (options.includeGuide !== false) entries.push({ path: "00 Home/Export Guide.md", data: renderGuide(), kind: "markdown" });
  const canvas = renderProjectCanvas(graph, pathMap, options.canvasNodeLimit ?? 36);
  entries.push({ path: canvasPath, data: `${JSON.stringify(canvas, null, 2)}\n`, kind: "canvas" });

  const manifest: ObsidianVaultManifest = {
    format: "context-vault-obsidian-vault",
    version: 1,
    generatedAt,
    projectId: graph.projectId,
    graphHash: graph.graphHash,
    canvasPath,
    files: [],
    pathMap,
  };
  const validationBeforeSystem = validateObsidianVaultEntries(entries, canvas);
  const linkedNodeIds = new Set(graph.edges.flatMap((edge) => [edge.from, edge.to]));
  const orphanNodeIds = graph.nodes.filter((node) => !linkedNodeIds.has(node.id)).map((node) => node.id).sort();
  const status = validationBeforeSystem.duplicatePaths.length || validationBeforeSystem.brokenLinks.length || validationBeforeSystem.invalidCanvasReferences.length
    ? "PARTIAL"
    : "COMPLETE";
  const report: ObsidianVaultReport = {
    status,
    projectId: graph.projectId,
    graphHash: graph.graphHash,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    markdownFiles: entries.filter((entry) => entry.kind === "markdown").length,
    canvasNodes: canvas.nodes.length,
    canvasEdges: canvas.edges.length,
    reusedPaths: allocation.reusedPaths,
    allocatedPaths: allocation.allocatedPaths,
    removedPaths: allocation.removedPaths,
    duplicatePaths: validationBeforeSystem.duplicatePaths,
    brokenLinks: validationBeforeSystem.brokenLinks,
    invalidCanvasReferences: validationBeforeSystem.invalidCanvasReferences,
    orphanNodeIds,
  };
  entries.push({ path: "99 System/path-map.json", data: `${JSON.stringify(pathMap, null, 2)}\n`, kind: "json" });
  entries.push({ path: "99 System/export-report.json", data: `${JSON.stringify(report, null, 2)}\n`, kind: "json" });
  const importManifest = buildImportManifest(graph, entries, canvasPath, generatedAt);
  entries.push({ path: "99 System/kv-import-manifest.json", data: `${JSON.stringify(importManifest, null, 2)}\n`, kind: "json" });
  entries.push({ path: "99 System/kv-import-receipt.template.json", data: `${JSON.stringify(buildReceiptTemplate(graph), null, 2)}\n`, kind: "json" });
  manifest.files = entries.map((entry) => ({
    path: entry.path,
    nodeId: entry.nodeId ?? null,
    kind: entry.kind,
    sourceHash: entry.sourceHash ?? null,
  }));
  manifest.files.push({ path: "99 System/contextvault-manifest.json", nodeId: null, kind: "json", sourceHash: null });
  entries.push({ path: "99 System/contextvault-manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n`, kind: "json" });
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { entries, manifest, report, pathMap, canvas };
}
