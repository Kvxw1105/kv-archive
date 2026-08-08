export class HistoryApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "HistoryApiError";
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.url = options.url ?? null;
    this.body = options.body ?? null;
    this.diagnostic = options.diagnostic ?? null;
  }
}

const asArray = (value) => Array.isArray(value) ? value : [];
const cleanText = (value) => typeof value === "string" ? value.trim() : "";

export function normalizeConversationListResponse(payload) {
  const candidates = [
    payload,
    payload?.items,
    payload?.conversations,
    payload?.conversations?.items,
    payload?.data?.items,
    payload?.data?.conversations,
    payload?.data?.conversations?.items,
  ];
  const items = candidates.find(Array.isArray) ?? [];
  const totalCandidates = [payload?.total, payload?.count, payload?.data?.total, payload?.data?.count];
  const total = totalCandidates.find((value) => Number.isFinite(value)) ?? null;
  return {
    items: items.filter((item) => item && typeof item === "object"),
    total,
  };
}

export function normalizeProjectListResponse(payload) {
  const rawItems = asArray(payload?.items ?? payload?.data?.items ?? payload?.projects ?? payload);
  const items = rawItems.map(projectMetadata).filter(Boolean);
  const cursorValue = payload?.cursor ?? payload?.next_cursor ?? payload?.conversations?.cursor ?? payload?.data?.cursor ?? payload?.data?.conversations?.cursor ?? null;
  const cursor = cursorValue === null || cursorValue === undefined || cursorValue === ""
    ? null
    : String(cursorValue);
  return { items, cursor };
}

export function normalizeProjectConversationListResponse(payload, project) {
  const normalized = normalizeConversationListResponse(payload);
  const cursorValue = payload?.cursor ?? payload?.next_cursor ?? payload?.conversations?.cursor ?? payload?.data?.cursor ?? payload?.data?.conversations?.cursor ?? null;
  const cursor = cursorValue === null || cursorValue === undefined || cursorValue === ""
    ? null
    : String(cursorValue);
  return {
    items: normalized.items.map((item) => conversationMetadata(item, {
      sourceType: "project",
      projectId: project?.id ?? null,
      projectTitle: project?.title ?? null,
      workspaceId: project?.workspaceId ?? null,
    })).filter(Boolean),
    cursor,
    total: normalized.total,
  };
}

export function projectMetadata(item) {
  if (!item || typeof item !== "object") return null;
  const wrapper = item.gizmo && typeof item.gizmo === "object" ? item.gizmo : item;
  const core = wrapper.gizmo && typeof wrapper.gizmo === "object" ? wrapper.gizmo : wrapper;
  const id = cleanText(core.id ?? wrapper.id ?? item.id);
  if (!id) return null;
  const display = core.display && typeof core.display === "object"
    ? core.display
    : wrapper.display && typeof wrapper.display === "object"
      ? wrapper.display
      : {};
  const embedded = wrapper.conversations && typeof wrapper.conversations === "object"
    ? wrapper.conversations
    : core.conversations && typeof core.conversations === "object"
      ? core.conversations
      : null;
  return {
    id,
    title: cleanText(display.name ?? core.name ?? core.display_name ?? wrapper.display_name) || "未命名项目",
    description: cleanText(display.description ?? core.description ?? wrapper.description),
    workspaceId: cleanText(core.workspace_id ?? wrapper.workspace_id ?? item.workspace_id) || null,
    createdAt: core.created_at ?? wrapper.created_at ?? null,
    updatedAt: core.updated_at ?? wrapper.updated_at ?? null,
    files: asArray(wrapper.files ?? core.files).filter((file) => file && typeof file === "object"),
    embeddedConversations: asArray(embedded?.items).filter((conversation) => conversation && typeof conversation === "object"),
    embeddedCursor: embedded?.cursor === null || embedded?.cursor === undefined || embedded?.cursor === ""
      ? null
      : String(embedded.cursor),
    present: true,
    raw: item,
  };
}

export function conversationMetadata(item, context = {}) {
  const id = item?.id ?? item?.conversation_id ?? item?.conversationId ?? null;
  if (typeof id !== "string" || !id) return null;
  const sourceType = context.sourceType ?? (item.is_archived ? "archived" : "regular");
  const projectId = context.projectId ?? item.gizmo_id ?? item.project_id ?? null;
  const projectTitle = context.projectTitle ?? item.project_title ?? null;
  const workspaceId = context.workspaceId ?? item.workspace_id ?? null;
  const location = {
    type: sourceType,
    projectId: projectId ? String(projectId) : null,
    projectTitle: projectTitle ? String(projectTitle) : null,
    workspaceId: workspaceId ? String(workspaceId) : null,
    present: true,
  };
  const provider = context.provider ?? item.provider ?? "chatgpt";
  const collectionRefs = location.projectId ? [{
    provider,
    collectionId: location.projectId,
    kind: sourceType === "project" ? "project" : "collection",
    title: location.projectTitle,
    nativeId: location.projectId,
  }] : [];
  return {
    id,
    provider,
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "未命名对话",
    createTime: item.create_time ?? item.created_at ?? item.createTime ?? null,
    updateTime: item.update_time ?? item.updated_at ?? item.updateTime ?? null,
    isArchived: sourceType === "archived" || Boolean(item.is_archived),
    projectId: location.projectId,
    projectTitle: location.projectTitle,
    workspaceId: location.workspaceId,
    primaryCollectionId: location.projectId,
    collectionRefs,
    locations: [location],
    raw: item,
  };
}

function looksLikeWorkspaceId(value) {
  return typeof value === "string" && (
    /^ws-[a-z0-9-]+$/i.test(value)
    || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
  );
}

export function normalizeAuthContext(session, pageState = {}) {
  const candidates = new Map();
  const activeHints = new Set();
  const visited = new Set();

  const addCandidate = (id, label = "", active = false) => {
    const cleanId = cleanText(id);
    if (!looksLikeWorkspaceId(cleanId)) return;
    const previous = candidates.get(cleanId) ?? { id: cleanId, label: "", active: false };
    const next = {
      id: cleanId,
      label: cleanText(label) || previous.label || "工作空间",
      active: Boolean(active || previous.active),
    };
    candidates.set(cleanId, next);
    if (next.active) activeHints.add(cleanId);
  };

  const walk = (value, path = "", depth = 0) => {
    if (!value || typeof value !== "object" || visited.has(value) || depth > 9) return;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      const nextPath = `${path}.${key}`.toLowerCase();
      if (typeof child === "string" && /account|workspace/.test(nextPath) && looksLikeWorkspaceId(child)) {
        const owner = value;
        addCandidate(
          child,
          owner.name ?? owner.label ?? owner.display_name ?? owner.workspace_name ?? owner.account_name ?? owner.plan_type,
          owner.is_current_account ?? owner.is_current ?? owner.current ?? owner.active ?? false,
        );
      } else if (child && typeof child === "object") {
        const explicitId = child.account_id ?? child.workspace_id ?? null;
        if (explicitId) {
          addCandidate(
            explicitId,
            child.name ?? child.label ?? child.display_name ?? child.workspace_name ?? child.account_name ?? child.plan_type,
            child.is_current_account ?? child.is_current ?? child.current ?? child.active ?? false,
          );
        }
        walk(child, nextPath, depth + 1);
      }
    }
  };

  walk(session, "session");
  walk(pageState.nextData, "nextData");
  for (const entry of asArray(pageState.storageEntries)) {
    const key = cleanText(entry?.key).toLowerCase();
    const value = cleanText(entry?.value);
    if (!/account|workspace/.test(key)) continue;
    const matches = value.match(/(?:ws-[a-z0-9-]+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/ig) ?? [];
    for (const id of matches) addCandidate(id, "工作空间", /active|current|last/.test(key));
  }

  const explicitActive = [
    session?.active_account_id,
    session?.current_account_id,
    session?.account?.id,
    session?.user?.account?.id,
    pageState.activeWorkspaceId,
  ].map(cleanText).find((value) => looksLikeWorkspaceId(value));
  if (explicitActive) activeHints.add(explicitActive);

  const workspaceCandidates = [...candidates.values()];
  const activeWorkspaceId = explicitActive
    || workspaceCandidates.find((candidate) => candidate.active)?.id
    || (workspaceCandidates.length === 1 ? workspaceCandidates[0].id : null);
  const activeCandidate = workspaceCandidates.find((candidate) => candidate.id === activeWorkspaceId);
  return {
    accessToken: cleanText(session?.accessToken) || null,
    workspaceId: activeWorkspaceId,
    workspaceLabel: activeCandidate?.label || (activeWorkspaceId ? "当前工作空间" : "个人空间"),
    workspaceCandidates,
    deviceId: cleanText(pageState.deviceId) || null,
  };
}

export async function discoverChatGPTAuthContext(tabId) {
  const executions = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      let session = {};
      try {
        const response = await fetch("/api/auth/session?unstable_client=true", { credentials: "include" });
        if (response.ok) session = await response.json();
      } catch {}

      let nextData = null;
      try {
        const node = document.getElementById("__NEXT_DATA__");
        if (node?.textContent) nextData = JSON.parse(node.textContent);
      } catch {}

      const storageEntries = [];
      for (const storage of [localStorage, sessionStorage]) {
        try {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (!key || !/account|workspace/i.test(key)) continue;
            storageEntries.push({ key, value: storage.getItem(key) || "" });
          }
        } catch {}
      }
      let deviceId = "";
      try {
        deviceId = document.cookie.match(/(?:^|;\s*)oai-did=([^;]+)/i)?.[1] || "";
      } catch {}
      return { session, nextData, storageEntries, deviceId };
    },
  });
  const result = executions?.[0]?.result;
  if (!result) throw new HistoryApiError("无法读取 ChatGPT 登录上下文，请刷新 ChatGPT 页面后重试。");
  return normalizeAuthContext(result.session ?? {}, {
    nextData: result.nextData ?? null,
    storageEntries: result.storageEntries ?? [],
    deviceId: result.deviceId ?? null,
  });
}

export async function fetchJsonInChatGPTTab(tabId, path, options = {}) {
  const authContext = options.authContext ?? {};
  const headers = { Accept: "application/json" };
  if (authContext.accessToken) headers.Authorization = `Bearer ${authContext.accessToken}`;
  if (authContext.workspaceId) headers["ChatGPT-Account-Id"] = authContext.workspaceId;
  if (authContext.deviceId) headers["oai-device-id"] = authContext.deviceId;

  const timeoutMs = Math.max(5_000, Number(options.timeoutMs ?? 60_000));
  const executions = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (requestPath, requestHeaders, requestTimeoutMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch(requestPath, {
          method: "GET",
          credentials: "include",
          headers: requestHeaders,
          signal: controller.signal,
        });
        const contentType = response.headers.get("content-type") || "";
        let payload = null;
        let bodyPreview = "";
        let parseFailed = false;
        if (/json/i.test(contentType)) {
          try {
            payload = await response.json();
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            parseFailed = true;
          }
        } else {
          bodyPreview = (await response.text()).slice(0, 65_536);
          if (bodyPreview) {
            try { payload = JSON.parse(bodyPreview); }
            catch { parseFailed = true; }
          }
        }
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          retryAfter: response.headers.get("retry-after"),
          payload,
          bodyPreview,
          parseFailed,
        };
      } catch (error) {
        return {
          ok: false,
          status: error?.name === "AbortError" ? 408 : 503,
          statusText: error?.name === "AbortError" ? `请求超过 ${Math.round(requestTimeoutMs / 1000)} 秒` : (error?.message || "网络请求失败"),
          url: requestPath,
          retryAfter: null,
          payload: null,
          bodyPreview: "",
          parseFailed: false,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    args: [path, headers, timeoutMs],
  });

  const result = executions?.[0]?.result;
  if (!result) throw new HistoryApiError("无法在 ChatGPT 页面中执行请求，请刷新页面后重试。", { url: path });

  const payload = result.payload ?? null;

  if (!result.ok) {
    const retryAfterSeconds = Number(result.retryAfter);
    const retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : null;
    const detail = payload?.detail ?? payload?.message ?? result.statusText ?? "请求失败";
    throw new HistoryApiError(`ChatGPT 接口返回 ${result.status}：${detail}`, {
      status: result.status,
      retryAfterMs,
      url: result.url ?? path,
      body: payload ?? result.bodyPreview,
    });
  }

  if (payload === null || result.parseFailed) {
    throw new HistoryApiError("ChatGPT 返回了无法解析的数据。", {
      status: result.status,
      url: result.url ?? path,
      body: result.bodyPreview,
    });
  }
  return payload;
}

export function normalizeSignedAssetResponse(payload, fallback = {}) {
  const downloadUrl = cleanText(payload?.download_url ?? payload?.downloadUrl ?? payload?.url);
  if (!downloadUrl) throw new HistoryApiError("ChatGPT 未返回可下载的附件地址。", { body: payload });
  return {
    downloadUrl,
    fileName: cleanText(payload?.file_name ?? payload?.filename ?? payload?.name ?? fallback.fileName) || null,
    mimeType: cleanText(payload?.content_type ?? payload?.mime_type ?? payload?.mimeType ?? fallback.mimeType) || null,
    sizeBytes: Number.isFinite(Number(payload?.file_size_bytes ?? payload?.size_bytes ?? payload?.size))
      ? Number(payload?.file_size_bytes ?? payload?.size_bytes ?? payload?.size)
      : null,
  };
}

export function decodeBase64ChunkInto(base64, output, offset = 0) {
  const binary = atob(String(base64 || ""));
  if (!(output instanceof Uint8Array)) throw new TypeError("output must be a Uint8Array");
  if (offset < 0 || offset + binary.length > output.length) throw new HistoryApiError("附件分块超出目标缓冲区。", { status: 422 });
  for (let index = 0; index < binary.length; index += 1) output[offset + index] = binary.charCodeAt(index);
  return binary.length;
}

export function decodeBase64Chunks(chunks, expectedBytes = null) {
  const decoded = [];
  let total = 0;
  for (const chunk of chunks ?? []) {
    const binary = atob(String(chunk || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    decoded.push(bytes);
    total += bytes.length;
  }
  if (Number.isFinite(expectedBytes) && total !== expectedBytes) {
    throw new HistoryApiError(`附件分块传输不完整：预期 ${expectedBytes} 字节，实际 ${total} 字节。`, { status: 422 });
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const bytes of decoded) {
    output.set(bytes, offset);
    offset += bytes.length;
  }
  return output;
}

export async function fetchBinaryInChatGPTTab(tabId, url, options = {}) {
  const maxBytes = Number(options.maxBytes ?? 64 * 1024 * 1024);
  const chunkBytes = Math.max(64 * 1024, Math.min(Number(options.chunkBytes ?? 1024 * 1024), 4 * 1024 * 1024));
  const transferId = `contextvault-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const initialExecutions = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (downloadUrl, byteLimit, transferKey) => {
      const response = await fetch(downloadUrl, { method: "GET", credentials: "omit" });
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > byteLimit) {
        return { ok: false, status: 413, error: `附件大小 ${contentLength} 字节，超过当前单文件安全上限。` };
      }
      if (!response.ok) return { ok: false, status: response.status, error: response.statusText || "附件下载失败" };
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > byteLimit) {
        return { ok: false, status: 413, error: `附件大小 ${buffer.byteLength} 字节，超过当前单文件安全上限。` };
      }
      const registry = globalThis.__contextVaultAssetTransfers ??= Object.create(null);
      registry[transferKey] = buffer;
      return {
        ok: true,
        status: response.status,
        sizeBytes: buffer.byteLength,
        contentType: response.headers.get("content-type"),
        contentDisposition: response.headers.get("content-disposition"),
        finalUrl: response.url,
      };
    },
    args: [url, maxBytes, transferId],
  });
  const initial = initialExecutions?.[0]?.result;
  if (!initial) throw new HistoryApiError("无法读取附件二进制内容。", { url });
  if (!initial.ok) throw new HistoryApiError(initial.error || "附件下载失败。", { status: initial.status, url });

  const output = new Uint8Array(initial.sizeBytes);
  let written = 0;
  try {
    for (let start = 0; start < initial.sizeBytes; start += chunkBytes) {
      const end = Math.min(initial.sizeBytes, start + chunkBytes);
      const executions = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (transferKey, from, to) => {
          const buffer = globalThis.__contextVaultAssetTransfers?.[transferKey];
          if (!buffer) return { ok: false, error: "附件临时缓存已丢失，请重试。" };
          const bytes = new Uint8Array(buffer, from, to - from);
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
          }
          return { ok: true, base64: btoa(binary), sizeBytes: bytes.length };
        },
        args: [transferId, start, end],
      });
      const chunk = executions?.[0]?.result;
      if (!chunk?.ok) throw new HistoryApiError(chunk?.error || "附件分块读取失败。", { status: 422, url });
      const decoded = decodeBase64ChunkInto(chunk.base64, output, start);
      if (decoded !== chunk.sizeBytes) throw new HistoryApiError("附件分块长度校验失败。", { status: 422, url });
      written += decoded;
    }
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (transferKey) => {
        if (globalThis.__contextVaultAssetTransfers) delete globalThis.__contextVaultAssetTransfers[transferKey];
      },
      args: [transferId],
    }).catch(() => {});
  }

  let downloadHost = null;
  try { downloadHost = new URL(cleanText(initial.finalUrl) || url).host || null; } catch {}
  if (written !== initial.sizeBytes) throw new HistoryApiError(`附件分块传输不完整：预期 ${initial.sizeBytes} 字节，实际 ${written} 字节。`, { status: 422, url });
  return {
    bytes: output,
    mimeType: cleanText(initial.contentType) || null,
    contentDisposition: cleanText(initial.contentDisposition) || null,
    status: initial.status ?? null,
    downloadHost,
  };
}

function filenameFromDisposition(value) {
  const text = cleanText(value);
  if (!text) return null;
  const utf8 = text.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try { return decodeURIComponent(utf8); } catch { return utf8; }
  }
  return text.match(/filename="?([^";]+)"?/i)?.[1]?.trim() || null;
}

async function firstSuccessful(requests) {
  let lastError = null;
  for (const request of requests) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (![400, 404].includes(error?.status)) throw error;
    }
  }
  throw lastError ?? new HistoryApiError("所有兼容接口均请求失败");
}

async function firstSuccessfulDetailed(requests) {
  let lastError = null;
  const attempts = [];
  for (const item of requests) {
    try {
      const value = await item.request();
      attempts.push({ label: item.label, result: "success", status: 200 });
      return { value, selected: item.label, attempts };
    } catch (error) {
      lastError = error;
      attempts.push({
        label: item.label,
        result: "failed",
        status: error?.status ?? null,
        message: cleanText(error?.message).slice(0, 240),
      });
      if (![400, 404].includes(error?.status)) {
        if (error && typeof error === "object") error.diagnostic = { attempts };
        throw error;
      }
    }
  }
  const error = lastError ?? new HistoryApiError("所有兼容接口均请求失败");
  if (error && typeof error === "object") error.diagnostic = { attempts };
  throw error;
}

export function createChatGPTTransport(tabId, options = {}) {
  let contextPromise = null;
  const resetContext = () => { contextPromise = null; };
  const getContext = async () => {
    if (!contextPromise) {
      contextPromise = discoverChatGPTAuthContext(tabId).then((context) => {
        const requestedWorkspaceId = cleanText(options.workspaceId);
        if (!requestedWorkspaceId) return context;
        const candidate = context.workspaceCandidates.find((item) => item.id === requestedWorkspaceId);
        return {
          ...context,
          workspaceId: requestedWorkspaceId,
          workspaceLabel: candidate?.label || options.workspaceLabel || "选定工作空间",
        };
      });
    }
    return contextPromise;
  };
  const getJson = async (path, { retryAuth = true, timeoutMs = options.requestTimeoutMs } = {}) => {
    try {
      return await fetchJsonInChatGPTTab(tabId, path, { authContext: await getContext(), timeoutMs });
    } catch (error) {
      if (!retryAuth || ![401, 403].includes(error?.status)) throw error;
      resetContext();
      return fetchJsonInChatGPTTab(tabId, path, { authContext: await getContext(), timeoutMs });
    }
  };

  const verifySession = async () => {
    resetContext();
    try {
      await getJson("/backend-api/conversations?offset=0&limit=1&order=updated", { retryAuth: false });
      return true;
    } catch (error) {
      if ([401, 403].includes(error?.status)) return false;
      return null;
    }
  };

  const signAsset = async (asset) => {
    const conversationId = asset.conversationIds?.[0] ?? asset.references?.find((item) => item?.conversationId)?.conversationId ?? null;
    const fileId = encodeURIComponent(asset.fileId);
    return firstSuccessfulDetailed([
      ...(conversationId ? [{
        label: "conversation-scoped-files-download",
        request: () => getJson(`/backend-api/files/download/${fileId}?conversation_id=${encodeURIComponent(conversationId)}&inline=false`),
      }] : []),
      { label: "global-files-download", request: () => getJson(`/backend-api/files/download/${fileId}?inline=false`) },
      { label: "file-download-action", request: () => getJson(`/backend-api/files/${fileId}/download`) },
    ]);
  };

  return {
    async getContext() {
      const context = await getContext();
      return {
        provider: "chatgpt",
        workspaceId: context.workspaceId ?? null,
        workspaceLabel: context.workspaceLabel,
        workspaceCandidates: context.workspaceCandidates.map(({ id, label }) => ({ id, label })),
        authenticated: Boolean(context.accessToken),
      };
    },
    async verifySession() {
      return verifySession();
    },
    async listConversations({ offset, limit, archived = false }) {
      const archivedQuery = archived ? "&is_archived=true" : "";
      const payload = await getJson(
        `/backend-api/conversations?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}&order=updated${archivedQuery}`,
      );
      const response = normalizeConversationListResponse(payload);
      const context = await getContext();
      return {
        ...response,
        items: response.items.map((item) => conversationMetadata(item, {
          sourceType: archived ? "archived" : "regular",
          workspaceId: context.workspaceId,
        })).filter(Boolean),
      };
    },
    async listProjects({ cursor = null } = {}) {
      const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const payload = await firstSuccessful([
        () => getJson(`/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0${cursorQuery}`),
        () => getJson(`/backend-api/gizmos/snorlax/sidebar?${cursor ? `cursor=${encodeURIComponent(cursor)}` : ""}`.replace(/\?$/, "")),
      ]);
      const response = normalizeProjectListResponse(payload);
      const workspaceId = (await getContext()).workspaceId;
      return {
        ...response,
        items: response.items.map((project) => ({ ...project, workspaceId: project.workspaceId ?? workspaceId })),
      };
    },
    async listProjectConversations({ project, cursor = "0" }) {
      const payload = await getJson(
        `/backend-api/gizmos/${encodeURIComponent(project.id)}/conversations?cursor=${encodeURIComponent(cursor)}`,
      );
      return normalizeProjectConversationListResponse(payload, project);
    },
    async fetchConversation(id) {
      return getJson(`/backend-api/conversation/${encodeURIComponent(id)}`, {
        timeoutMs: options.conversationTimeoutMs ?? 60_000,
      });
    },
    async downloadAsset(asset, downloadOptions = {}) {
      if (!asset?.fileId) throw new HistoryApiError("附件缺少 fileId，无法自动下载。", { status: 422 });
      let signing = await signAsset(asset);
      let signed = normalizeSignedAssetResponse(signing.value, asset);
      let binary;
      try {
        binary = await fetchBinaryInChatGPTTab(tabId, signed.downloadUrl, { maxBytes: downloadOptions.maxBytes });
      } catch (error) {
        if ([401, 403].includes(error?.status)) {
          signing = await signAsset(asset);
          signed = normalizeSignedAssetResponse(signing.value, asset);
          try {
            binary = await fetchBinaryInChatGPTTab(tabId, signed.downloadUrl, { maxBytes: downloadOptions.maxBytes });
          } catch (retryError) {
            if (retryError && typeof retryError === "object") {
              retryError.diagnostic = {
                signingEndpoint: signing.selected,
                signingAttempts: signing.attempts,
                binaryStatus: retryError.status ?? null,
                renewedSignedUrl: true,
              };
            }
            throw retryError;
          }
        } else {
          if (error && typeof error === "object") {
            error.diagnostic = {
              signingEndpoint: signing.selected,
              signingAttempts: signing.attempts,
              binaryStatus: error.status ?? null,
            };
          }
          throw error;
        }
      }
      return {
        bytes: binary.bytes,
        fileName: filenameFromDisposition(binary.contentDisposition) || signed.fileName || asset.fileName || asset.fileId,
        mimeType: binary.mimeType || signed.mimeType || asset.mimeType || "application/octet-stream",
        expectedBytes: signed.sizeBytes ?? asset.expectedBytes ?? null,
        sizeBytes: binary.bytes.byteLength,
        diagnostics: {
          signingEndpoint: signing.selected,
          signingAttempts: signing.attempts,
          binaryStatus: binary.status,
          downloadHost: binary.downloadHost,
        },
      };
    },
  };
}
