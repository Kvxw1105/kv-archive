import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildProjectMemoryCandidates, evaluateMemoryGate, renderMemoryGateMarkdown } from "./memory-gate.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const SUPPORTED_BUDGETS = [2048, 8192, 32768];

function crc32(bytes) {
  if (!crc32.table) {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crc32.table[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function readU16(view, offset) { return view.getUint16(offset, true); }
function readU32(view, offset) { return view.getUint32(offset, true); }

export function readStoredZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = readU32(view, offset);
    if (signature === 0x04034b50) {
      if (offset + 30 > bytes.length) throw new Error("Agent Bundle ZIP local header is truncated");
      const flags = readU16(view, offset + 6);
      const method = readU16(view, offset + 8);
      const expectedCrc = readU32(view, offset + 14);
      const compressedSize = readU32(view, offset + 18);
      const uncompressedSize = readU32(view, offset + 22);
      const nameLength = readU16(view, offset + 26);
      const extraLength = readU16(view, offset + 28);
      if (flags & 0x0001) throw new Error("Encrypted Agent Bundles are not supported");
      if (method !== 0) throw new Error("Agent Bundle must use stored ZIP entries");
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > bytes.length) throw new Error("Agent Bundle ZIP entry is truncated");
      const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
      if (!name || name.startsWith("/") || name.includes("..") || name.includes("\\")) throw new Error(`Unsafe Agent Bundle path: ${name}`);
      const data = bytes.slice(dataStart, dataEnd);
      if (data.length !== uncompressedSize) throw new Error(`Agent Bundle entry size mismatch: ${name}`);
      if (crc32(data) !== expectedCrc) throw new Error(`Agent Bundle entry CRC mismatch: ${name}`);
      entries.set(name, data);
      offset = dataEnd;
      continue;
    }
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    throw new Error(`Unknown Agent Bundle ZIP signature at offset ${offset}`);
  }
  return entries;
}

function parseJsonLines(text, label) {
  const rows = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try { rows.push(JSON.parse(line)); }
    catch (error) { throw new Error(`${label} line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return rows;
}

async function loadEntries(bundlePath) {
  const absolute = resolve(bundlePath);
  const info = await stat(absolute);
  if (info.isDirectory()) {
    const read = async (name) => new Uint8Array(await readFile(join(absolute, name)));
    const entries = new Map([
      ["manifest.json", await read("manifest.json")],
      ["data/conversations.jsonl", await read("data/conversations.jsonl")],
      ["data/messages.jsonl", await read("data/messages.jsonl")],
      ["data/evidence.jsonl", await read("data/evidence.jsonl")],
    ]);
    for (const name of ["data/project-states.jsonl","data/content-objects.jsonl","data/content-versions.jsonl","data/content-relations.jsonl","data/content-operations.jsonl","data/content-promotions.jsonl"]) {
      try { entries.set(name, await read(name)); } catch {}
    }
    return entries;
  }
  return readStoredZipEntries(new Uint8Array(await readFile(absolute)));
}

function requireEntry(entries, name) {
  const value = entries.get(name);
  if (!value) throw new Error(`Agent Bundle is missing ${name}`);
  return decoder.decode(value);
}

export function loadAgentBundleEntries(entries) {
  const manifest = JSON.parse(requireEntry(entries, "manifest.json"));
  if (manifest?.format !== "context-vault-agent-bundle") throw new Error("Not a ContextVault Agent Bundle");
  if (![1, 2, 3].includes(manifest?.version)) throw new Error(`Unsupported Agent Bundle version: ${manifest?.version}`);
  const conversations = parseJsonLines(requireEntry(entries, "data/conversations.jsonl"), "conversations.jsonl");
  const messages = parseJsonLines(requireEntry(entries, "data/messages.jsonl"), "messages.jsonl");
  const evidence = parseJsonLines(requireEntry(entries, "data/evidence.jsonl"), "evidence.jsonl");
  const optionalJsonl = (name) => { const entry = entries.get(name); return entry ? parseJsonLines(decoder.decode(entry), name.split("/").pop()) : []; };
  const states = optionalJsonl("data/project-states.jsonl");
  const contentObjects = optionalJsonl("data/content-objects.jsonl");
  const contentVersions = optionalJsonl("data/content-versions.jsonl");
  const contentRelations = optionalJsonl("data/content-relations.jsonl");
  const contentOperations = optionalJsonl("data/content-operations.jsonl");
  const contentPromotions = optionalJsonl("data/content-promotions.jsonl");
  return { manifest, conversations, messages, evidence, states, contentObjects, contentVersions, contentRelations, contentOperations, contentPromotions };
}

export function loadAgentBundleBytes(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return loadAgentBundleEntries(readStoredZipEntries(value));
}

export async function loadAgentBundle(bundlePath) {
  return loadAgentBundleEntries(await loadEntries(bundlePath));
}

export function normalizeSearchText(value) { return String(value || "").normalize("NFKC").toLowerCase(); }

export function tokenizeText(value) {
  const text = normalizeSearchText(value);
  const tokens = new Set();
  for (const match of text.matchAll(/[a-z0-9][a-z0-9_+.-]{1,63}/g)) tokens.add(match[0]);
  const runs = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || [];
  for (const run of runs) {
    const chars = [...run];
    for (const char of chars) tokens.add(char);
    for (let i = 0; i < chars.length - 1; i += 1) tokens.add(chars[i] + chars[i + 1]);
    for (let i = 0; i < chars.length - 2; i += 1) tokens.add(chars[i] + chars[i + 1] + chars[i + 2]);
  }
  return [...tokens].filter(Boolean).slice(0, 20_000);
}

export function estimateTokens(value) {
  const text = String(value || "");
  const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
  const nonCjk = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, "").length;
  return Math.max(1, Math.ceil(cjk * 1.15 + nonCjk / 4));
}

function safeDate(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function clip(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n…[truncated]`;
}

function snippet(text, query, maxChars = 500) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const q = normalizeSearchText(query);
  const normalized = normalizeSearchText(clean);
  const index = q ? normalized.indexOf(q) : 0;
  const start = Math.max(0, index < 0 ? 0 : index - Math.floor(maxChars / 4));
  const body = clean.slice(start, start + maxChars);
  return `${start > 0 ? "…" : ""}${body}${start + maxChars < clean.length ? "…" : ""}`;
}

function contentProvenance(object) {
  return {
    uri: `contextvault://content/${encodeURIComponent(object.id)}?revision=${encodeURIComponent(object.revision)}&hash=${encodeURIComponent(object.contentHash)}`,
    objectId: object.id,
    revision: object.revision,
    contentHash: object.contentHash,
    projectId: object.projectId || null,
    projectTitle: object.projectTitle || null,
    kind: object.kind,
  };
}

function provenance(message, conversation) {
  const hash = message.evidenceHash || conversation.currentEvidenceHash || "unknown";
  return {
    uri: `contextvault://conversation/${encodeURIComponent(conversation.conversationId)}/node/${encodeURIComponent(message.nodeId)}?evidence=${encodeURIComponent(hash)}`,
    conversationKey: conversation.key,
    conversationId: conversation.conversationId,
    nodeId: message.nodeId,
    messageId: message.messageId || null,
    evidenceHash: hash,
    sourceKinds: conversation.sourceKinds || [],
    projectId: conversation.projectId || null,
    projectTitle: conversation.projectTitle || null,
    activePath: Boolean(message.activePath),
  };
}

function filterMatch(message, conversation, filters = {}) {
  if (filters.projectId && filters.projectId !== conversation.projectId) return false;
  if (filters.projectTitle && !normalizeSearchText(conversation.projectTitle).includes(normalizeSearchText(filters.projectTitle))) return false;
  if (filters.conversationIds?.length && !filters.conversationIds.includes(conversation.conversationId) && !filters.conversationIds.includes(conversation.key)) return false;
  if (filters.roles?.length && !filters.roles.includes(message.role)) return false;
  if (filters.sourceKind && !(conversation.sourceKinds || []).includes(filters.sourceKind)) return false;
  if (filters.activePathOnly && !message.activePath) return false;
  if (filters.archived === true && !conversation.archived) return false;
  if (filters.archived === false && conversation.archived) return false;
  const time = safeDate(message.createdAt || conversation.updatedAt || conversation.createdAt);
  if (filters.dateFrom && time < safeDate(`${filters.dateFrom}T00:00:00Z`)) return false;
  if (filters.dateTo && time > safeDate(`${filters.dateTo}T23:59:59.999Z`)) return false;
  return true;
}

export class AgentRepository {
  constructor(bundle) {
    this.manifest = bundle.manifest;
    this.conversations = new Map(bundle.conversations.map((row) => [row.key, row]));
    this.conversationById = new Map(bundle.conversations.map((row) => [row.conversationId, row]));
    this.messages = bundle.messages;
    this.evidence = new Map(bundle.evidence.map((row) => [row.key, row]));
    this.projectStates = new Map((bundle.states || []).map((row) => [row.projectId, row]));
    this.contentObjects = new Map((bundle.contentObjects || []).map((row) => [row.id, row]));
    this.contentVersions = bundle.contentVersions || [];
    this.contentRelations = bundle.contentRelations || [];
    this.contentOperations = bundle.contentOperations || [];
    this.contentPromotions = bundle.contentPromotions || [];
    this.contentPostings = new Map();
    this.provenanceUris = new Set();
    this.messagesByConversation = new Map();
    this.postings = new Map();
    for (const message of this.messages) {
      if (!this.messagesByConversation.has(message.conversationKey)) this.messagesByConversation.set(message.conversationKey, []);
      this.messagesByConversation.get(message.conversationKey).push(message);
      for (const token of tokenizeText(`${message.text}\n${this.conversations.get(message.conversationKey)?.title || ""}`)) {
        if (!this.postings.has(token)) this.postings.set(token, new Set());
        this.postings.get(token).add(message.key);
      }
    }
    for (const rows of this.messagesByConversation.values()) rows.sort((a, b) => safeDate(a.createdAt) - safeDate(b.createdAt) || String(a.nodeId).localeCompare(String(b.nodeId)));
    this.messageByKey = new Map(this.messages.map((row) => [row.key, row]));
    for (const message of this.messages) {
      const conversation = this.conversations.get(message.conversationKey);
      if (conversation) this.provenanceUris.add(provenance(message, conversation).uri);
    }
    for (const object of this.contentObjects.values()) {
      this.provenanceUris.add(contentProvenance(object).uri);
      for (const token of tokenizeText(`${object.title || ""}\n${object.body || ""}\n${(object.tags || []).join(" ")}`)) {
        if (!this.contentPostings.has(token)) this.contentPostings.set(token, new Set());
        this.contentPostings.get(token).add(object.id);
      }
    }
  }

  stats() {
    const projects = new Map();
    for (const row of this.conversations.values()) if (row.projectId) projects.set(row.projectId, row.projectTitle || row.projectId);
    for (const row of this.contentObjects.values()) if (row.projectId) projects.set(row.projectId,row.projectTitle||row.projectId);
    for (const row of this.projectStates.values()) if (row.projectId) projects.set(row.projectId,row.projectTitle||row.projectId);
    return {
      bundleId: this.manifest.bundleId,
      createdAt: this.manifest.createdAt,
      readOnly: true,
      conversations: this.conversations.size,
      messages: this.messages.length,
      evidence: this.evidence.size,
      contentObjects: this.contentObjects.size,
      contentVersions: this.contentVersions.length,
      contentRelations: this.contentRelations.length,
      contentOperations: this.contentOperations.length,
      contentPromotions: this.contentPromotions.length,
      projects: projects.size,
      approvedProjectStates: this.projectStates.size,
      proposalWorkflow: this.manifest.proposalWorkflow || "unsupported",
      sourceKinds: [...new Set([...this.conversations.values()].flatMap((row) => row.sourceKinds || []))].sort(),
      supportedTokenBudgets: SUPPORTED_BUDGETS,
    };
  }

  listProjects() {
    const projects = new Map();
    for (const conversation of this.conversations.values()) {
      if (!conversation.projectId) continue;
      const current = projects.get(conversation.projectId) || { id: conversation.projectId, title: conversation.projectTitle || conversation.projectId, conversations: 0, messages: 0, updatedAt: null };
      current.conversations += 1;
      current.messages += conversation.messageCount || 0;
      if (safeDate(conversation.updatedAt) > safeDate(current.updatedAt)) current.updatedAt = conversation.updatedAt;
      projects.set(conversation.projectId, current);
    }
    for (const object of this.contentObjects.values()) {
      if (!object.projectId || object.status === "trashed") continue;
      const current = projects.get(object.projectId) || { id: object.projectId, title: object.projectTitle || object.projectId, conversations: 0, messages: 0, contentObjects: 0, updatedAt: null };
      current.contentObjects = Number(current.contentObjects || 0) + 1;
      if (safeDate(object.updatedAt) > safeDate(current.updatedAt)) current.updatedAt = object.updatedAt;
      projects.set(object.projectId, current);
    }
    for (const state of this.projectStates.values()) {
      const current = projects.get(state.projectId) || { id: state.projectId, title: state.projectTitle || state.projectId, conversations: 0, messages: 0, updatedAt: null };
      current.approvedStateVersion = state.stateVersion || 0;
      current.approvedStateHealth = state.status?.health || "unknown";
      projects.set(state.projectId, current);
    }
    return [...projects.values()].sort((a, b) => safeDate(b.updatedAt) - safeDate(a.updatedAt) || a.title.localeCompare(b.title, "zh-CN"));
  }

  projectState(identifier) {
    if (this.projectStates.has(identifier)) return structuredClone(this.projectStates.get(identifier));
    const needle = normalizeSearchText(identifier);
    const match = [...this.projectStates.values()].find((row) => normalizeSearchText(row.projectTitle).includes(needle));
    return match ? structuredClone(match) : null;
  }

  hasProvenanceUri(uri) { return this.provenanceUris.has(String(uri || "")); }

  searchMessages(filters = {}) {
    const query = String(filters.query || "").trim();
    const queryTokens = tokenizeText(query);
    let candidates;
    if (queryTokens.length) {
      for (const token of queryTokens) {
        const set = this.postings.get(token) || new Set();
        candidates = candidates === undefined ? new Set(set) : new Set([...candidates].filter((key) => set.has(key)));
        if (candidates.size === 0) break;
      }
    }
    const rows = (candidates ? [...candidates].map((key) => this.messageByKey.get(key)).filter(Boolean) : this.messages).map((message) => {
      const conversation = this.conversations.get(message.conversationKey);
      if (!conversation || !filterMatch(message, conversation, filters)) return null;
      const normalized = normalizeSearchText(`${conversation.title}\n${message.text}`);
      const q = normalizeSearchText(query);
      if (q && !normalized.includes(q) && !queryTokens.every((token) => normalized.includes(token))) return null;
      let score = q && normalized.includes(q) ? 100 : queryTokens.filter((token) => normalized.includes(token)).reduce((sum, token) => sum + Math.min(12, token.length * 3), 0);
      if (message.activePath) score += 8;
      if (message.role === "user") score += 2;
      score += Math.min(5, safeDate(conversation.updatedAt) / 1e13);
      return {
        score,
        conversation: {
          key: conversation.key,
          conversationId: conversation.conversationId,
          title: conversation.title,
          projectId: conversation.projectId || null,
          projectTitle: conversation.projectTitle || null,
          archived: Boolean(conversation.archived),
          updatedAt: conversation.updatedAt || null,
          sourceKinds: conversation.sourceKinds || [],
        },
        message: {
          key: message.key,
          nodeId: message.nodeId,
          messageId: message.messageId || null,
          role: message.role,
          createdAt: message.createdAt || null,
          activePath: Boolean(message.activePath),
          text: filters.includeFullText ? message.text : snippet(message.text, query, filters.snippetChars || 500),
        },
        provenance: provenance(message, conversation),
      };
    }).filter(Boolean);
    rows.sort((a, b) => b.score - a.score || safeDate(b.conversation.updatedAt) - safeDate(a.conversation.updatedAt) || a.message.key.localeCompare(b.message.key));
    return rows.slice(0, Math.max(1, Math.min(Number(filters.limit || 20), 200)));
  }

  listContent(filters = {}) {
    let rows = [...this.contentObjects.values()];
    if (filters.projectId) rows = rows.filter((row) => row.projectId === filters.projectId);
    if (filters.projectTitle) { const needle = normalizeSearchText(filters.projectTitle); rows = rows.filter((row) => normalizeSearchText(row.projectTitle).includes(needle)); }
    if (filters.kind && filters.kind !== "all") rows = rows.filter((row) => row.kind === filters.kind);
    if (filters.status && filters.status !== "all") rows = rows.filter((row) => row.status === filters.status);
    else if (!filters.includeTrashed) rows = rows.filter((row) => row.status !== "trashed");
    rows.sort((a,b)=>safeDate(b.updatedAt)-safeDate(a.updatedAt)||String(a.id).localeCompare(String(b.id)));
    const limit=Math.max(1,Math.min(Number(filters.limit||100),1000));
    return rows.slice(0,limit).map((row)=>({
      id:row.id,kind:row.kind,projectId:row.projectId||null,projectTitle:row.projectTitle||null,title:row.title,status:row.status,revision:row.revision,tags:row.tags||[],summary:row.summary||"",updatedAt:row.updatedAt||null,provenance:contentProvenance(row),
    }));
  }

  readContent(identifier, options = {}) {
    const object=this.contentObjects.get(identifier);
    if(!object)throw new Error(`Content object not found: ${identifier}`);
    const maxChars=Math.max(200,Math.min(Number(options.maxChars||100000),1000000));
    return {
      object:{...object,body:clip(object.body,maxChars)},
      provenance:contentProvenance(object),
      versions:this.contentVersions.filter((row)=>row.objectId===object.id).sort((a,b)=>Number(b.revision)-Number(a.revision)),
      relations:this.contentRelations.filter((row)=>row.fromId===object.id||row.toId===object.id),
      operations:options.includeOperations===false?[]:this.contentOperations.filter((row)=>row.objectId===object.id),
      promotions:options.includePromotions===false?[]:this.contentPromotions.filter((row)=>row.sourceObjectId===object.id),
      truncated:String(object.body||"").length>maxChars,
    };
  }

  searchContent(filters = {}) {
    const query=String(filters.query||"").trim();
    const queryTokens=tokenizeText(query);
    let ids;
    for(const token of queryTokens){const set=this.contentPostings.get(token)||new Set();ids=ids===undefined?new Set(set):new Set([...ids].filter((id)=>set.has(id)));if(ids.size===0)break;}
    let rows=(ids?[...ids].map((id)=>this.contentObjects.get(id)).filter(Boolean):[...this.contentObjects.values()]);
    if(filters.projectId)rows=rows.filter((row)=>row.projectId===filters.projectId);
    if(filters.projectTitle){const needle=normalizeSearchText(filters.projectTitle);rows=rows.filter((row)=>normalizeSearchText(row.projectTitle).includes(needle));}
    if(filters.kind&&filters.kind!=="all")rows=rows.filter((row)=>row.kind===filters.kind);
    if(filters.status&&filters.status!=="all")rows=rows.filter((row)=>row.status===filters.status);else rows=rows.filter((row)=>row.status!=="trashed");
    const q=normalizeSearchText(query);
    const results=rows.map((object)=>{const normalized=normalizeSearchText(`${object.title||""}\n${object.body||""}\n${(object.tags||[]).join(" ")}`);if(q&&!normalized.includes(q)&&!queryTokens.every((token)=>normalized.includes(token)))return null;let score=q&&normalizeSearchText(object.title).includes(q)?20:0;score+=queryTokens.filter((token)=>normalized.includes(token)).length*3;score+=Math.min(5,safeDate(object.updatedAt)/1e13);return{score,object:{id:object.id,kind:object.kind,projectId:object.projectId||null,projectTitle:object.projectTitle||null,title:object.title,status:object.status,revision:object.revision,tags:object.tags||[],updatedAt:object.updatedAt||null,body:filters.includeFullText?object.body:snippet(object.body,query,filters.snippetChars||500)},provenance:contentProvenance(object)};}).filter(Boolean);
    results.sort((a,b)=>b.score-a.score||safeDate(b.object.updatedAt)-safeDate(a.object.updatedAt)||a.object.id.localeCompare(b.object.id));
    return results.slice(0,Math.max(1,Math.min(Number(filters.limit||20),200)));
  }

  resolveConversation(identifier) {
    return this.conversations.get(identifier) || this.conversationById.get(identifier) || null;
  }

  readConversation(identifier, options = {}) {
    const conversation = this.resolveConversation(identifier);
    if (!conversation) throw new Error(`Conversation not found: ${identifier}`);
    let messages = [...(this.messagesByConversation.get(conversation.key) || [])];
    if (options.activePathOnly !== false) messages = messages.filter((row) => row.activePath);
    if (options.roles?.length) messages = messages.filter((row) => options.roles.includes(row.role));
    const limit = Math.max(1, Math.min(Number(options.maxMessages || 200), 2000));
    messages = messages.slice(0, limit).map((message) => ({
      nodeId: message.nodeId,
      messageId: message.messageId || null,
      role: message.role,
      createdAt: message.createdAt || null,
      activePath: Boolean(message.activePath),
      text: clip(message.text, Math.max(200, Math.min(Number(options.maxCharsPerMessage || 12_000), 100_000))),
      provenance: provenance(message, conversation),
    }));
    return { conversation, messages, truncated: messages.length < (this.messagesByConversation.get(conversation.key) || []).length };
  }

  projectSnapshot(projectIdentifier, options = {}) {
    const needle = normalizeSearchText(projectIdentifier);
    const conversations = [...this.conversations.values()].filter((row) => row.projectId === projectIdentifier || normalizeSearchText(row.projectTitle).includes(needle))
      .sort((a, b) => safeDate(b.updatedAt) - safeDate(a.updatedAt));
    const content = [...this.contentObjects.values()].filter((row) => row.status !== "trashed" && (row.projectId === projectIdentifier || normalizeSearchText(row.projectTitle).includes(needle)))
      .sort((a,b)=>safeDate(b.updatedAt)-safeDate(a.updatedAt));
    const state=this.projectState(projectIdentifier);
    const projectId=conversations[0]?.projectId||content[0]?.projectId||state?.projectId;
    const projectTitle=conversations[0]?.projectTitle||content[0]?.projectTitle||state?.projectTitle||projectId;
    if (!projectId) throw new Error(`Project not found: ${projectIdentifier}`);
    const limit = Math.max(1, Math.min(Number(options.conversationLimit || 50), 500));
    const contentLimit=Math.max(1,Math.min(Number(options.contentLimit||100),1000));
    return {
      project: { id: projectId, title: projectTitle || projectId },
      approvedState: this.projectState(projectId),
      conversationCount: conversations.length,
      messageCount: conversations.reduce((sum, row) => sum + (row.messageCount || 0), 0),
      contentObjectCount: content.length,
      latestUpdatedAt: [conversations[0]?.updatedAt,content[0]?.updatedAt].filter(Boolean).sort((a,b)=>safeDate(b)-safeDate(a))[0] || null,
      contentObjects: content.slice(0,contentLimit).map((row)=>({id:row.id,kind:row.kind,title:row.title,status:row.status,revision:row.revision,updatedAt:row.updatedAt,provenance:contentProvenance(row)})),
      conversations: conversations.slice(0, limit).map((row) => ({
        conversationId: row.conversationId,
        title: row.title,
        updatedAt: row.updatedAt || null,
        archived: Boolean(row.archived),
        messageCount: row.messageCount || 0,
        activeMessageCount: row.activeMessageCount || 0,
        sourceKinds: row.sourceKinds || [],
        evidenceHash: row.currentEvidenceHash,
      })),
      truncated: conversations.length > limit || content.length > contentLimit,
    };
  }

  sourceEvidence(identifier, options = {}) {
    const conversation = this.resolveConversation(identifier);
    const evidence = conversation ? this.evidence.get(conversation.currentEvidenceKey) : this.evidence.get(identifier);
    if (!evidence) throw new Error(`Evidence not found: ${identifier}`);
    const mode = options.mode || "metadata";
    const base = {
      evidenceKey: evidence.key,
      evidenceHash: evidence.evidenceHash,
      conversationId: evidence.conversationId,
      sourceKind: evidence.sourceKind,
      sourceFileName: evidence.sourceFileName,
      sourceFingerprint: evidence.sourceFingerprint,
      importedAt: evidence.importedAt,
      sourceMetadata: evidence.sourceMetadata || null,
    };
    if (mode === "metadata") return base;
    const payload = mode === "raw" ? evidence.rawEvidence : evidence.canonical;
    const serialized = JSON.stringify(payload, null, 2);
    const maxChars = Math.max(1_000, Math.min(Number(options.maxChars || 100_000), 2_000_000));
    return { ...base, mode, payload: serialized.length <= maxChars ? payload : clip(serialized, maxChars), truncated: serialized.length > maxChars };
  }

  runMemoryGate(options = {}) {
    const identifier = options.projectId || options.projectTitle || options.project;
    if (!identifier) throw new Error("Provide projectId, projectTitle, or project");
    const state = this.projectState(identifier);
    if (!state) throw new Error(`Approved Project State not found: ${identifier}`);
    const candidates = buildProjectMemoryCandidates(state, { verifyEvidence: (uri) => uri.startsWith("contextvault://project/") || this.hasProvenanceUri(uri) });
    return evaluateMemoryGate(candidates, {
      projectId: state.projectId,
      projectTitle: state.projectTitle,
      policy: options.policy || options.memoryGatePolicy || "balanced",
      target: options.target || "internal",
      tokenBudget: options.tokenBudget || options.memoryGateBudgetTokens || 2048,
      generatedAt: options.generatedAt,
    });
  }

  buildContextPack(options = {}) {
    const budget = SUPPORTED_BUDGETS.includes(Number(options.budgetTokens)) ? Number(options.budgetTokens) : 8192;
    let gateReport = null;
    let gatedMemory = "";
    if (options.memoryGatePolicy) {
      const memoryBudget = Math.max(256, Math.min(Number(options.memoryGateBudgetTokens || Math.floor(budget * 0.35)), Math.max(256, budget - 256)));
      gateReport = this.runMemoryGate({
        projectId: options.projectId,
        projectTitle: options.projectTitle,
        project: options.project,
        policy: options.memoryGatePolicy,
        target: options.memoryGateTarget || "internal",
        tokenBudget: memoryBudget,
        generatedAt: options.generatedAt,
      });
      gatedMemory = renderMemoryGateMarkdown(gateReport, { includeDiagnostics: false });
    }
    const search = this.searchMessages({
      query: options.query || "",
      projectId: options.projectId,
      projectTitle: options.projectTitle,
      conversationIds: options.conversationIds,
      roles: options.roles,
      sourceKind: options.sourceKind,
      activePathOnly: options.activePathOnly !== false,
      limit: Math.max(50, Math.min(Number(options.candidateLimit || 500), 2000)),
      includeFullText: true,
    });
    const contentSearch = this.searchContent({ query: options.query || "", projectId: options.projectId, projectTitle: options.projectTitle, limit: Math.max(20, Math.min(Number(options.contentCandidateLimit || 200), 1000)), includeFullText: true });
    const perConversation = new Map();
    const selected = [];
    for (const result of search) {
      const count = perConversation.get(result.conversation.conversationId) || 0;
      if (count >= Math.max(1, Math.min(Number(options.maxExcerptsPerConversation || 3), 10))) continue;
      perConversation.set(result.conversation.conversationId, count + 1);
      selected.push({ type:"message", ...result });
    }
    for (const result of contentSearch) selected.push({ type:"content", ...result });
    selected.sort((a,b)=>b.score-a.score||String(a.type).localeCompare(String(b.type)));
    const header = [
      "# ContextVault Context Pack",
      "",
      `- Bundle: ${this.manifest.bundleId}`,
      `- Query: ${options.query || "(none)"}`,
      `- Token budget: ${budget}`,
      `- Policy: read-only evidence excerpts; no inferred summary`,
      ...(options.memoryGatePolicy ? [`- Memory Gate: ${options.memoryGatePolicy}`] : []),
      "",
    ].join("\n");
    let text = `${header}${gatedMemory ? `\n${gatedMemory}\n` : ""}`;
    if (estimateTokens(text) > budget) throw new Error("Locked Memory Gate content exceeds the Context Pack token budget; increase --budget or reduce locked memory.");
    const sources = [];
    let truncated = false;
    for (let index = 0; index < selected.length; index += 1) {
      const item = selected[index];
      const label = `S${index + 1}`;
      const fixed = item.type === "content" ? [
        `## [${label}] ${item.object.title}`,
        "",
        `- Type: ${item.object.kind}`,
        `- Project: ${item.object.projectTitle || "(none)"}`,
        `- Updated: ${item.object.updatedAt || "unknown"}`,
        `- Status: ${item.object.status}`,
        `- Evidence: ${item.provenance.uri}`,
        "",
      ].join("\n") : [
        `## [${label}] ${item.conversation.title}`,
        "",
        `- Role: ${item.message.role}`,
        `- Project: ${item.conversation.projectTitle || "(none)"}`,
        `- Updated: ${item.conversation.updatedAt || "unknown"}`,
        `- Active path: ${item.message.activePath ? "yes" : "no"}`,
        `- Evidence: ${item.provenance.uri}`,
        "",
      ].join("\n");
      const remaining = budget - estimateTokens(text + fixed + "\n");
      if (remaining < 80) { truncated = true; break; }
      const maxChars = Math.max(200, Math.floor(remaining * 3.4));
      const body = clip(item.type === "content" ? item.object.body : item.message.text, maxChars);
      const section = `${fixed}${body}\n\n`;
      if (estimateTokens(text + section) > budget) {
        const tighter = clip(body, Math.max(100, Math.floor(maxChars * 0.75)));
        const tightSection = `${fixed}${tighter}\n\n`;
        if (estimateTokens(text + tightSection) > budget) { truncated = true; break; }
        text += tightSection;
        truncated = true;
      } else text += section;
      sources.push(item.type === "content" ? { label, ...item.provenance, title:item.object.title, role:"content" } : { label, ...item.provenance, title: item.conversation.title, role: item.message.role });
    }
    const footer = ["---", "", "## Source Index", "", ...sources.map((source) => `- [${source.label}] ${source.uri}`), ""].join("\n");
    if (estimateTokens(text + footer) <= budget) text += footer;
    else truncated = true;
    return {
      format: "context-vault-context-pack",
      version: 1,
      bundleId: this.manifest.bundleId,
      budgetTokens: budget,
      estimatedTokens: estimateTokens(text),
      query: options.query || "",
      selectedExcerpts: sources.length,
      truncated,
      sources,
      memoryGate: gateReport ? {
        policy: gateReport.policy,
        counts: gateReport.counts,
        usedTokens: gateReport.usedTokens,
        tokenBudget: gateReport.tokenBudget,
        budgetOverrun: gateReport.budgetOverrun,
      } : null,
      markdown: text,
    };
  }
}

export async function openAgentRepository(bundlePath) { return new AgentRepository(await loadAgentBundle(bundlePath)); }
export { SUPPORTED_BUDGETS };
