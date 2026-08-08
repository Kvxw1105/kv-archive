import { CANONICAL_SCHEMA_VERSION } from "./packages/domain/src/index.js";
import { detectProviderFromUrl } from "./provider-registry.js";

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim() : "";
}

function observedRole(value) {
  const role = String(value || "").toLowerCase();
  if (/^(?:user|human)$|prompt|question|\byou\b|\bme\b/.test(role)) return "user";
  if (/^(?:assistant|model|bot|ai)$|answer|response/.test(role)) return "assistant";
  return "unknown";
}

function safeRole(value, index, semanticType = null) {
  const role = observedRole(value);
  if (role !== "unknown") return role;
  if (semanticType === "user_voice_transcript") return "user";
  if (semanticType === "assistant_voice_transcript") return "assistant";
  return index % 2 === 0 ? "user" : "assistant";
}

function safeSemanticType(value, role) {
  const semantic = String(value || "").trim();
  const allowed = new Set([
    "user",
    "user_voice_transcript",
    "assistant_final",
    "assistant_voice_transcript",
    "assistant_intermediate",
    "tool_call",
    "tool_result",
    "reasoning",
    "system",
    "developer",
    "unknown",
  ]);
  if (allowed.has(semantic)) return semantic;
  if (role === "user") return "user";
  if (role === "assistant") return "assistant_final";
  return "unknown";
}

export function parseStableTurnOrdinal(value) {
  const text = cleanText(value);
  const match = text.match(/(?:conversation[-_ ]?turn|turn)[-_: ]?(\d+)(?:$|[^0-9])/i);
  return match ? Number(match[1]) : null;
}

export function computeRestoredScrollTop({
  initialScrollHeight,
  initialClientHeight,
  initialScrollTop,
  finalScrollHeight,
  finalClientHeight,
}) {
  const initialHeight = Math.max(0, Number(initialScrollHeight) || 0);
  const initialViewport = Math.max(0, Number(initialClientHeight) || 0);
  const initialTop = Math.max(0, Number(initialScrollTop) || 0);
  const finalHeight = Math.max(0, Number(finalScrollHeight) || 0);
  const finalViewport = Math.max(0, Number(finalClientHeight) || 0);
  const distanceFromBottom = Math.max(0, initialHeight - initialViewport - initialTop);
  return Math.max(0, finalHeight - finalViewport - distanceFromBottom);
}

function stableConversationId(url, title, messages) {
  const raw = `${url || ""}\n${title || ""}\n${messages.map((message) => `${message.role}:${message.text}`).join("\n")}`;
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `visible-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const comparableKey = (message) => {
  const stableId = cleanText(message?.stableId);
  if (stableId) return `id:${stableId}`;
  const role = observedRole(message?.role);
  const text = cleanText(message?.text);
  return text ? `content:${role}:${text}` : null;
};

const rolesCompatible = (left, right) => {
  const leftRole = observedRole(left);
  const rightRole = observedRole(right);
  return leftRole === "unknown" || rightRole === "unknown" || leftRole === rightRole;
};

const sameMessage = (left, right) => {
  const leftId = cleanText(left?.stableId);
  const rightId = cleanText(right?.stableId);
  if (leftId && rightId) return leftId === rightId;
  return rolesCompatible(left?.role, right?.role) && cleanText(left?.text) === cleanText(right?.text);
};

/**
 * Batches arrive newest viewport first, then progressively older viewports.
 * Merge by suffix/prefix overlap so virtualized DOM windows can be accumulated
 * without collapsing legitimate repeated messages that have distinct IDs.
 * Unknown roles are intentionally not guessed per viewport; parity is applied
 * only after the complete merged sequence is reconstructed.
 */
export function mergeHydratedMessageBatches(batches) {
  let merged = [];
  for (const rawBatch of Array.isArray(batches) ? batches : []) {
    const batch = (Array.isArray(rawBatch) ? rawBatch : [])
      .map((message) => ({
        ...message,
        role: observedRole(message?.role),
        text: cleanText(message?.text),
        stableId: cleanText(message?.stableId) || null,
      }))
      .filter((message) => message.text);
    if (!batch.length) continue;
    if (!merged.length) {
      merged = batch;
      continue;
    }

    let overlap = 0;
    const maximum = Math.min(batch.length, merged.length);
    for (let size = maximum; size > 0; size -= 1) {
      let matches = true;
      for (let index = 0; index < size; index += 1) {
        if (!sameMessage(batch[batch.length - size + index], merged[index])) {
          matches = false;
          break;
        }
      }
      if (matches) {
        overlap = size;
        break;
      }
    }
    merged = [...batch.slice(0, batch.length - overlap), ...merged];
  }

  const seenStableIds = new Set();
  const output = [];
  for (const message of merged) {
    const key = comparableKey(message);
    if (message.stableId && key) {
      if (seenStableIds.has(key)) continue;
      seenStableIds.add(key);
    }
    const previous = output.at(-1);
    if (!message.stableId && previous && !previous.stableId && sameMessage(previous, message)) continue;
    output.push(message);
  }
  return output;
}

export function normalizeVisibleConversationSnapshot(snapshot, options = {}) {
  const sourceUrl = options.sourceUrl ?? snapshot?.url ?? null;
  const provider = options.provider ?? detectProviderFromUrl(sourceUrl).id;
  const rawMessages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const messages = rawMessages
    .map((message, index) => {
      const initialSemanticType = safeSemanticType(message?.semanticType, observedRole(message?.role));
      const role = safeRole(message?.role, index, initialSemanticType);
      return {
        role,
        semanticType: safeSemanticType(initialSemanticType, role),
        text: cleanText(message?.text),
        html: typeof message?.html === "string" ? message.html : null,
        createdAt: typeof message?.createdAt === "string" ? message.createdAt : null,
        stableId: cleanText(message?.stableId) || null,
        metadata: message?.metadata && typeof message.metadata === "object" ? message.metadata : {},
      };
    })
    .filter((message) => message.text);
  if (messages.length === 0) throw new Error("没有在当前页面识别到可见的对话消息");

  const title = cleanText(snapshot?.title) || "网页 AI 对话";
  const conversationId = cleanText(snapshot?.conversationId) || stableConversationId(sourceUrl, title, messages);
  const nodes = {};
  const edges = [];
  const activePath = [];
  let parentId = null;
  messages.forEach((message, index) => {
    const nodeId = `visible-${String(index + 1).padStart(4, "0")}`;
    const nextId = index + 1 < messages.length ? `visible-${String(index + 2).padStart(4, "0")}` : null;
    nodes[nodeId] = {
      nodeId,
      parentId,
      childrenIds: nextId ? [nextId] : [],
      messageId: message.stableId || nodeId,
      role: message.role,
      semanticType: message.semanticType,
      createdAt: message.createdAt,
      updatedAt: null,
      content: [{ type: "text", text: message.text, rawPayload: { text: message.text, html: message.html } }],
      model: null,
      status: "finished_successfully",
      metadata: { ...message.metadata, stableDomId: message.stableId, captureMode: "visible-only" },
      rawPayload: message,
    };
    if (parentId) edges.push({ from: parentId, to: nodeId });
    activePath.push(nodeId);
    parentId = nodeId;
  });

  const completeness = options.completeness ?? "visible-only";
  const diagnostics = snapshot?.diagnostics ?? {};
  const hydrationAttempted = Boolean(diagnostics.hydrationAttempted ?? diagnostics.hydratedHistory);
  const hydrationComplete = Boolean(diagnostics.hydrationComplete);
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    conversationId,
    title,
    source: {
      provider,
      adapter: options.adapter ?? (hydrationAttempted ? "dom-history-hydrator" : "generic-dom-visible"),
      sourceUrl,
      captureMode: "visible-only",
      completeness,
    },
    createdAt: snapshot?.capturedAt ?? new Date().toISOString(),
    updatedAt: snapshot?.capturedAt ?? new Date().toISOString(),
    currentNodeId: activePath.at(-1) ?? null,
    nodes,
    edges,
    activePath,
    projectId: null,
    primaryCollectionId: null,
    collectionRefs: [],
    metadata: {
      visibleOnly: true,
      hydratedHistory: hydrationComplete,
      hydrationAttempted,
      hydrationComplete,
      pageTitle: title,
      captureDiagnostics: diagnostics,
      warning: hydrationComplete
        ? "The page reached a stable top and accumulated the visible history windows, but DOM capture still cannot prove hidden branches or original attachment completeness."
        : hydrationAttempted
          ? `History hydration did not complete (${diagnostics.hydrationOutcome || "unknown"}); the export may omit older messages, hidden branches or original attachments.`
          : "Only content visible in the page DOM was captured. Hidden history, branches, tool events and original attachments may be missing.",
    },
    rawMetadata: snapshot,
  };
}

export async function captureVisibleConversationFromTab(tabId, sourceUrl, options = {}) {
  const hydrateHistory = Boolean(options.hydrateHistory);
  const executions = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: async (settings) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const startedAt = Date.now();
      const cleanVisibleText = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
      const rawText = (element) => cleanVisibleText(element?.innerText || element?.textContent || "");
      const queryAllSafe = (root, selector) => {
        try { return [...(root?.querySelectorAll?.(selector) || [])]; } catch { return []; }
      };
      const messageContainerOf = (element) => element?.closest?.([
        "[data-message-author-role]",
        "[data-message-id]",
        "[data-testid^='conversation-turn-']",
        "[data-testid*='conversation-turn']",
        "[data-message-type]",
        "article",
        "[role='listitem']",
      ].join(", ")) || element;
      const identityText = (element) => {
        const nodes = [element, ...queryAllSafe(element, [
          "[data-message-type]",
          "[data-content-type]",
          "[data-testid]",
          "[data-voice-mode]",
          "[data-modality]",
          "[aria-label]",
          "[title]",
          "audio",
          "video",
          "svg",
          "use",
        ].join(", ")).slice(0, 48)];
        const values = [];
        for (const node of nodes) {
          for (const name of [
            "data-message-author-role",
            "data-role",
            "data-author",
            "data-speaker",
            "data-message-type",
            "data-content-type",
            "data-testid",
            "data-voice-mode",
            "data-modality",
            "aria-label",
            "title",
            "href",
            "xlink:href",
            "class",
          ]) {
            const value = node?.getAttribute?.(name);
            if (value) values.push(value);
          }
        }
        return values.join(" ").toLowerCase();
      };
      const voiceMarkerOf = (element) => {
        const identity = identityText(element);
        if (/(?:voice|audio|realtime|speech|transcript|transcription|microphone|camera|waveform)/i.test(identity)) return identity;
        if (element?.querySelector?.("audio,video")) return "embedded-media";
        return "";
      };
      const transcriptTextOf = (element) => {
        const selectors = [
          "[data-testid*='transcript']",
          "[data-message-type*='transcript']",
          "[data-content-type*='transcript']",
          "[data-content-type*='audio'] [data-testid*='text']",
          "[class*='transcript']",
          "[aria-label*='transcript' i]",
        ];
        const matches = selectors.flatMap((selector) => queryAllSafe(element, selector));
        const unique = [];
        for (const node of matches) {
          if (node.closest?.("button,nav,aside,[role='button']")) continue;
          const value = rawText(node);
          if (!value) continue;
          if (unique.some((entry) => entry.node === node || node.contains(entry.node))) continue;
          const outerIndex = unique.findIndex((entry) => entry.node.contains(node));
          if (outerIndex >= 0) unique.splice(outerIndex, 1, { node, value });
          else unique.push({ node, value });
        }
        return [...new Set(unique.map((entry) => entry.value))].join("\n").trim();
      };
      const messageTextOf = (element) => {
        const voiceMarker = voiceMarkerOf(element);
        if (voiceMarker) {
          const transcript = transcriptTextOf(element);
          if (transcript) return transcript;
        }
        const clone = element?.cloneNode?.(true);
        if (clone?.querySelectorAll) {
          for (const removable of clone.querySelectorAll("button,script,style,noscript,audio,video,[role='button']")) removable.remove();
          const cleaned = rawText(clone);
          if (cleaned) return cleaned;
        }
        return rawText(element);
      };
      const observedRoleOf = (element) => {
        const roleElement = element.closest?.("[data-message-author-role], [data-author], [data-speaker]")
          || element.querySelector?.("[data-message-author-role], [data-author], [data-speaker]")
          || element;
        const attrs = [
          roleElement.getAttribute?.("data-message-author-role"),
          roleElement.getAttribute?.("data-author"),
          roleElement.getAttribute?.("data-speaker"),
          element.getAttribute?.("data-role"),
          element.getAttribute?.("aria-label"),
          element.getAttribute?.("data-testid"),
          element.className,
          identityText(element),
        ].filter(Boolean).join(" ").toLowerCase();
        if (/\b(user|human|prompt|question|you|me)\b|用户|你说/.test(attrs)) return "user";
        if (/\b(assistant|model|bot|answer|response|chatgpt|ai)\b|助手|回答/.test(attrs)) return "assistant";
        return "unknown";
      };
      const semanticTypeOf = (element, role) => {
        const identity = element.closest?.("[data-message-author-role], [data-testid], [data-message-type], article") || element;
        const attrs = `${identityText(identity)} ${identityText(element)}`;
        if (/reasoning|analysis|thought/.test(attrs)) return "reasoning";
        if (/tool[-_ ]?result|tool[-_ ]?output|execution[-_ ]?output/.test(attrs)) return "tool_result";
        if (/tool|search|browser|connector|python|code[-_ ]?execution/.test(attrs)) return "tool_call";
        const isVoiceTranscript = Boolean(voiceMarkerOf(element));
        if (isVoiceTranscript && role === "user") return "user_voice_transcript";
        if (isVoiceTranscript && role === "assistant") return "assistant_voice_transcript";
        if (role === "user") return "user";
        if (role !== "assistant") return "unknown";
        if (/commentary|progress|status|intermediate|streaming/.test(attrs)) return "assistant_intermediate";
        return "assistant_final";
      };
      const stableIdOf = (element) => {
        const identity = element.closest?.("[data-message-id], [data-testid^='conversation-turn-'], article[id], [data-turn-id]") || element;
        return identity.getAttribute?.("data-message-id")
          || identity.getAttribute?.("data-turn-id")
          || identity.getAttribute?.("data-testid")
          || identity.id
          || null;
      };
      const turnOrdinal = (value) => {
        const match = String(value || "").match(/(?:conversation[-_ ]?turn|turn)[-_: ]?(\d+)(?:$|[^0-9])/i);
        return match ? Number(match[1]) : null;
      };
      const findElements = () => {
        const selectors = [
          '[data-message-author-role="user"], [data-message-author-role="assistant"]',
          '[data-testid^="conversation-turn-"], [data-testid*="message"]',
          '[data-message-type*="voice"], [data-message-type*="audio"], [data-message-type*="transcript"]',
          '[data-content-type*="voice"], [data-content-type*="audio"], [data-content-type*="transcript"]',
          '[data-testid*="voice"], [data-testid*="transcript"]',
          'main article',
          'main [class*="message"]',
          '[role="main"] article',
        ];
        const candidates = [];
        const seenContainers = new Set();
        for (const selector of selectors) {
          for (const match of queryAllSafe(document, selector)) {
            const element = messageContainerOf(match);
            if (!element || seenContainers.has(element)) continue;
            const value = messageTextOf(element);
            if (value.length < 2) continue;
            seenContainers.add(element);
            candidates.push(element);
          }
        }
        const unique = [];
        for (const element of candidates) {
          const value = messageTextOf(element);
          if (!value) continue;
          if (unique.some((item) => item.element === element || element.contains(item.element))) continue;
          const outerIndex = unique.findIndex((item) => item.element.contains(element));
          if (outerIndex >= 0) unique.splice(outerIndex, 1, { element, value });
          else unique.push({ element, value });
        }
        return unique.sort((left, right) => {
          if (left.element === right.element) return 0;
          const position = left.element.compareDocumentPosition(right.element);
          return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });
      };
      const snapshotBatch = () => findElements().map((item) => {
        const role = observedRoleOf(item.element);
        const voiceMarker = voiceMarkerOf(item.element);
        return {
          role,
          semanticType: semanticTypeOf(item.element, role),
          text: item.value,
          html: item.element.innerHTML || null,
          stableId: stableIdOf(item.element),
          metadata: {
            tagName: item.element.tagName,
            testId: item.element.getAttribute?.("data-testid") || null,
            voiceTranscript: Boolean(voiceMarker),
            voiceMarker: voiceMarker || null,
          },
        };
      });
      const documentScroller = document.scrollingElement || document.documentElement;
      const isDocumentScroller = (element) => element === documentScroller || element === document.documentElement || element === document.body;
      const scrollTopOf = (element) => isDocumentScroller(element)
        ? (window.scrollY || documentScroller?.scrollTop || 0)
        : element?.scrollTop || 0;
      const setScrollTop = (element, value) => {
        if (!element) return;
        if (isDocumentScroller(element)) window.scrollTo({ top: value, behavior: "auto" });
        else if (typeof element.scrollTo === "function") element.scrollTo({ top: value, behavior: "auto" });
        else element.scrollTop = value;
        element.dispatchEvent?.(new Event("scroll", { bubbles: true }));
      };
      const ancestorDistance = (child, ancestor) => {
        let current = child;
        let distance = 0;
        while (current && current !== ancestor && current !== document.documentElement) {
          current = current.parentElement;
          distance += 1;
        }
        return current === ancestor ? distance : 10_000;
      };
      const descriptor = (element) => {
        if (!element) return null;
        if (isDocumentScroller(element)) return "document";
        const id = element.id ? `#${element.id}` : "";
        const classes = typeof element.className === "string"
          ? element.className.trim().split(/\s+/).slice(0, 3).join(".")
          : "";
        return `${String(element.tagName || "element").toLowerCase()}${id}${classes ? `.${classes}` : ""}`.slice(0, 180);
      };
      const scrollCandidates = (elements) => {
        const candidates = [];
        const seen = new Set();
        const messageElements = elements.map((item) => item.element).filter(Boolean);
        const roots = [...messageElements, document.querySelector("main"), document.querySelector("[role='main']")].filter(Boolean);
        for (const root of roots) {
          let current = root;
          while (current && current !== document.documentElement) {
            if (!seen.has(current)) {
              seen.add(current);
              const style = getComputedStyle(current);
              const range = Math.max(0, current.scrollHeight - current.clientHeight);
              const scrollable = range > 120 && /(auto|scroll|overlay)/.test(style.overflowY || "");
              if (scrollable) candidates.push(current);
            }
            current = current.parentElement;
          }
        }
        if (documentScroller && documentScroller.scrollHeight > documentScroller.clientHeight + 120) candidates.push(documentScroller);
        return [...new Set(candidates)].map((element) => {
          const contained = messageElements.filter((message) => isDocumentScroller(element) || element.contains(message)).length;
          const distances = messageElements
            .filter((message) => isDocumentScroller(element) || element.contains(message))
            .map((message) => isDocumentScroller(element) ? ancestorDistance(message, document.documentElement) : ancestorDistance(message, element));
          const averageDistance = distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : 10_000;
          const semanticBonus = element.matches?.("main,[role='main']") ? 50_000 : 0;
          const navigationPenalty = element.matches?.("nav,aside,[role='navigation']") ? 2_000_000 : 0;
          const range = Math.max(0, element.scrollHeight - element.clientHeight);
          const score = contained * 1_000_000 - averageDistance * 20_000 + semanticBonus + Math.min(range, 100_000) - navigationPenalty;
          return { element, score, contained, averageDistance, range };
        }).filter((item) => item.contained > 0).sort((left, right) => right.score - left.score);
      };
      const scrollerUsable = (element, elements) => Boolean(
        element
        && element.isConnected !== false
        && Math.max(0, element.scrollHeight - element.clientHeight) > 120
        && elements.some((item) => isDocumentScroller(element) || element.contains(item.element)),
      );
      const batchKey = (message, index, options = {}) => {
        if (message.stableId) return `id:${message.stableId}`;
        const contentKey = `content:${message.role || "unknown"}:${String(message.text || "").slice(0, 500)}`;
        return options.positionSensitive === false ? contentKey : `${contentKey}:${index}`;
      };
      const observationKey = (message) => batchKey(message, 0, { positionSensitive: false });
      const batchSignature = (batch, scrollHeight) => {
        const identities = batch.map((message, index) => batchKey(message, index));
        return `${batch.length}:${identities[0] || ""}:${identities.at(-1) || ""}:${scrollHeight}`;
      };
      const createProgress = () => {
        const existing = document.getElementById("kv-archive-history-progress");
        existing?.remove();
        const panel = document.createElement("div");
        panel.id = "kv-archive-history-progress";
        panel.setAttribute("role", "status");
        panel.setAttribute("aria-live", "polite");
        panel.style.cssText = "position:fixed;right:18px;top:18px;z-index:2147483647;max-width:320px;padding:10px 12px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(20,20,20,.92);color:#fff;font:12px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.28);pointer-events:none";
        panel.textContent = "KV Archive 正在检查历史消息…";
        document.documentElement.appendChild(panel);
        return panel;
      };

      const initialElements = findElements();
      const initialBatch = snapshotBatch();
      const batches = [initialBatch];
      const observedKeys = new Set(initialBatch.map(observationKey));
      let candidates = scrollCandidates(initialElements);
      let scroller = candidates[0]?.element || documentScroller || document.documentElement;
      const initialScrollHeight = scroller?.scrollHeight || 0;
      const initialClientHeight = scroller?.clientHeight || window.innerHeight || 0;
      const initialScrollTop = scrollTopOf(scroller);
      const initialDistanceFromBottom = Math.max(0, initialScrollHeight - initialClientHeight - initialScrollTop);
      let stableAtTopRounds = 0;
      let iterations = 0;
      let reachedTop = initialScrollTop <= 2;
      let scrollerSwitches = 0;
      let stalledRounds = 0;
      let hydrationOutcome = settings.hydrateHistory ? "running" : "not-requested";
      let progress = null;
      let restoredScrollTop = initialScrollTop;
      let maximumSteps = 0;

      try {
        if (settings.hydrateHistory && scroller) {
          progress = createProgress();
          const baseStepSize = Math.max(360, Math.floor((initialClientHeight || window.innerHeight || 800) * 0.78));
          const estimatedSteps = Math.ceil(Math.max(0, initialScrollTop) / Math.max(1, baseStepSize)) + 32;
          maximumSteps = Math.max(1, Math.min(Math.max(Number(settings.maxSteps || 320), estimatedSteps), 800));
          const delayMs = Math.max(100, Math.min(Number(settings.delayMs || 260), 1_000));
          const topDelayMs = Math.max(delayMs * 2, Math.min(Number(settings.topDelayMs || 900), 2_500));
          const requiredStableRounds = Math.max(2, Math.min(Number(settings.stableRounds || 4), 10));
          const maxDurationMs = Math.max(15_000, Math.min(Number(settings.maxDurationMs || 120_000), 300_000));

          for (let step = 0; step < maximumSteps; step += 1) {
            iterations = step + 1;
            if (Date.now() - startedAt >= maxDurationMs) {
              hydrationOutcome = "time-limit";
              break;
            }

            const elements = findElements();
            if (!scrollerUsable(scroller, elements)) {
              candidates = scrollCandidates(elements);
              const replacement = candidates[0]?.element || scroller;
              if (replacement !== scroller) {
                scroller = replacement;
                scrollerSwitches += 1;
              }
            }

            const beforeTop = scrollTopOf(scroller);
            const beforeHeight = scroller?.scrollHeight || 0;
            const beforeObserved = observedKeys.size;
            const stepSize = Math.max(360, Math.floor((scroller?.clientHeight || window.innerHeight || 800) * 0.78));
            const targetTop = Math.max(0, beforeTop - stepSize);
            setScrollTop(scroller, targetTop);
            await sleep(beforeTop <= 2 ? topDelayMs : delayMs);

            const batch = snapshotBatch();
            batches.push(batch);
            batch.forEach((message) => observedKeys.add(observationKey(message)));
            const afterTop = scrollTopOf(scroller);
            const afterHeight = scroller?.scrollHeight || 0;
            const growth = observedKeys.size - beforeObserved;
            reachedTop = afterTop <= 2;
            const moved = Math.abs(afterTop - beforeTop) > 1 || Math.abs(afterHeight - beforeHeight) > 1;
            stalledRounds = !moved && growth === 0 ? stalledRounds + 1 : 0;

            if (progress) {
              progress.textContent = `KV Archive 正在向上加载历史 · 已观察 ${observedKeys.size} 条 · 第 ${iterations} 步${reachedTop ? " · 正在确认顶部" : ""}`;
            }

            if (reachedTop && growth === 0 && afterHeight === beforeHeight) stableAtTopRounds += 1;
            else stableAtTopRounds = 0;

            if (stableAtTopRounds >= requiredStableRounds) {
              hydrationOutcome = "complete";
              break;
            }
            if (stalledRounds >= 3 && !reachedTop) {
              setScrollTop(scroller, 0);
              await sleep(topDelayMs);
            }
            if (stalledRounds >= 7 && !reachedTop) {
              hydrationOutcome = "stalled";
              break;
            }
            if (step === maximumSteps - 1) hydrationOutcome = "step-limit";
          }
        }
      } finally {
        if (settings.hydrateHistory && scroller) {
          const finalScrollHeight = scroller.scrollHeight || 0;
          const finalClientHeight = scroller.clientHeight || window.innerHeight || 0;
          restoredScrollTop = Math.max(0, finalScrollHeight - finalClientHeight - initialDistanceFromBottom);
          setScrollTop(scroller, restoredScrollTop);
        }
        progress?.remove();
      }

      const finalBatch = snapshotBatch();
      batches.push(finalBatch);
      finalBatch.forEach((message) => observedKeys.add(observationKey(message)));
      const ordinals = batches.flat().map((message) => turnOrdinal(message.stableId)).filter((value) => Number.isFinite(value));
      const stableIds = batches.flat().map((message) => message.stableId).filter(Boolean);
      const hydrationComplete = hydrationOutcome === "complete";

      return {
        title: document.title,
        url: location.href,
        capturedAt: new Date().toISOString(),
        conversationId: location.pathname.match(/\/c\/([^/?#]+)/)?.[1] || null,
        batches,
        diagnostics: {
          hydrationAttempted: Boolean(settings.hydrateHistory),
          hydrationComplete,
          hydrationOutcome,
          initialVisibleMessages: initialBatch.length,
          uniqueObservedMessages: observedKeys.size,
          batchCount: batches.length,
          iterations,
          maximumSteps,
          reachedTop,
          stableAtTop: hydrationComplete,
          stalledRounds,
          scroller: descriptor(scroller),
          scrollerSwitches,
          initialScrollTop,
          initialScrollHeight,
          initialClientHeight,
          finalScrollHeight: scroller?.scrollHeight || 0,
          finalClientHeight: scroller?.clientHeight || window.innerHeight || 0,
          restoredScrollTop,
          minStableTurnOrdinal: ordinals.length ? Math.min(...ordinals) : null,
          maxStableTurnOrdinal: ordinals.length ? Math.max(...ordinals) : null,
          firstStableId: stableIds[0] || null,
          lastStableId: stableIds.at(-1) || null,
          initialSignature: batchSignature(initialBatch, initialScrollHeight),
          finalSignature: batchSignature(finalBatch, scroller?.scrollHeight || 0),
          durationMs: Date.now() - startedAt,
        },
      };
    },
    args: [{
      hydrateHistory,
      maxSteps: options.maxSteps ?? 320,
      delayMs: options.delayMs ?? 260,
      topDelayMs: options.topDelayMs ?? 900,
      stableRounds: options.stableRounds ?? 4,
      maxDurationMs: options.maxDurationMs ?? 120_000,
    }],
  });
  const rawSnapshot = executions?.[0]?.result;
  if (!rawSnapshot) throw new Error("无法读取当前网页的可见内容");
  const messages = mergeHydratedMessageBatches(rawSnapshot.batches);
  const snapshot = {
    ...rawSnapshot,
    batches: undefined,
    messages,
    diagnostics: {
      ...rawSnapshot.diagnostics,
      accumulatedMessages: messages.length,
    },
  };
  return {
    snapshot,
    canonical: normalizeVisibleConversationSnapshot(snapshot, {
      sourceUrl,
      provider: options.provider,
      adapter: options.adapter ?? (hydrateHistory ? "dom-history-hydrator" : "generic-dom-visible"),
      completeness: options.completeness ?? "visible-only",
    }),
  };
}
