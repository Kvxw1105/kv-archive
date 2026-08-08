const NOOP = () => {};

export function clampTaskProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function progressFromCounts(current, total) {
  const done = Number(current);
  const size = Number(total);
  if (!Number.isFinite(done) || !Number.isFinite(size) || size <= 0) return null;
  return clampTaskProgress((done / size) * 100);
}

export function formatTaskDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
}

export function estimateTaskRemaining({ startedAt, now = Date.now(), current, total } = {}) {
  const done = Number(current);
  const size = Number(total);
  const started = Number(startedAt);
  if (!Number.isFinite(done) || !Number.isFinite(size) || !Number.isFinite(started) || done <= 0 || size <= done) return null;
  const elapsed = Math.max(1, Number(now) - started);
  const rate = done / elapsed;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.max(0, Math.round((size - done) / rate));
}

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function inViewport(element) {
  if (!element?.getBoundingClientRect) return true;
  const rect = element.getBoundingClientRect();
  const height = globalThis.innerHeight || document.documentElement.clientHeight || 0;
  return rect.top >= 0 && rect.bottom <= height;
}

function createNoopController() {
  return {
    start: NOOP,
    update: NOOP,
    success: NOOP,
    fail: NOOP,
    pause: NOOP,
    clear: NOOP,
    restoreButton: NOOP,
    run: async (_options, worker) => worker({ update: NOOP }),
    get active() { return false; },
  };
}

export function createTaskFeedback({
  page = "KV Archive",
  compact = false,
  mount = null,
  before = null,
  autoScroll = true,
} = {}) {
  if (typeof document === "undefined") return createNoopController();
  if (!compact && globalThis.__KV_TASK_FEEDBACK__) return globalThis.__KV_TASK_FEEDBACK__;

  const host = mount || document.body;
  if (!compact) document.documentElement.classList.add("has-task-feedback");
  const root = document.createElement("section");
  root.className = `task-feedback${compact ? " task-feedback--compact" : ""}`;
  root.dataset.state = "idle";
  root.hidden = true;
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `
    <div class="task-feedback__signal" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="task-feedback__body">
      <div class="task-feedback__head">
        <div>
          <span class="task-feedback__eyebrow">${page} · TASK</span>
          <strong class="task-feedback__title">准备执行</strong>
        </div>
        <button class="task-feedback__collapse" type="button" aria-label="收起任务进度">−</button>
      </div>
      <p class="task-feedback__detail">点击后会在这里持续显示进度。</p>
      <div class="task-feedback__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span class="task-feedback__bar"></span>
      </div>
      <div class="task-feedback__meta">
        <span class="task-feedback__stage">等待开始</span>
        <span class="task-feedback__counts"></span>
        <span class="task-feedback__time">已用 0 秒</span>
        <span class="task-feedback__eta"></span>
      </div>
      <ol class="task-feedback__steps" aria-label="任务阶段">
        <li data-step="0">准备</li><li data-step="1">执行</li><li data-step="2">核验</li><li data-step="3">完成</li>
      </ol>
    </div>
  `;
  if (before && before.parentElement === host) host.insertBefore(root, before);
  else host.append(root);

  const ui = {
    body: root.querySelector(".task-feedback__body"),
    title: root.querySelector(".task-feedback__title"),
    detail: root.querySelector(".task-feedback__detail"),
    track: root.querySelector(".task-feedback__track"),
    bar: root.querySelector(".task-feedback__bar"),
    stage: root.querySelector(".task-feedback__stage"),
    counts: root.querySelector(".task-feedback__counts"),
    time: root.querySelector(".task-feedback__time"),
    eta: root.querySelector(".task-feedback__eta"),
    steps: [...root.querySelectorAll(".task-feedback__steps li")],
    collapse: root.querySelector(".task-feedback__collapse"),
  };

  let state = null;
  let clock = null;
  let dismissTimer = null;
  let stageTimers = [];
  let focusedAnchor = null;
  const buttons = new Map();

  function clearTimers() {
    if (clock) clearInterval(clock);
    clock = null;
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = null;
    for (const timer of stageTimers) clearTimeout(timer);
    stageTimers = [];
  }

  function updateClock() {
    if (!state?.startedAt) return;
    ui.time.textContent = `已用 ${formatTaskDuration(Date.now() - state.startedAt)}`;
    const remaining = estimateTaskRemaining({
      startedAt: state.startedAt,
      current: state.current,
      total: state.total,
    });
    ui.eta.textContent = remaining === null ? "" : `预计还需 ${formatTaskDuration(remaining)}`;
  }

  function setStep(step = 1, labels = null) {
    const normalized = Math.max(0, Math.min(3, Number(step) || 0));
    ui.steps.forEach((item, index) => {
      if (labels?.[index]) item.textContent = labels[index];
      item.dataset.state = index < normalized ? "done" : index === normalized ? "active" : "pending";
    });
  }

  function setProgress(progress, indeterminate = false) {
    const value = clampTaskProgress(progress);
    const unknown = indeterminate || value === null;
    root.dataset.indeterminate = unknown ? "true" : "false";
    ui.track.setAttribute("aria-valuenow", unknown ? "0" : String(value));
    ui.track.setAttribute("aria-valuetext", unknown ? "正在处理，暂时无法估算百分比" : `${value}%`);
    ui.bar.style.width = unknown ? "36%" : `${value}%`;
  }

  function focusAnchor(anchor) {
    if (focusedAnchor && focusedAnchor !== anchor) focusedAnchor.classList.remove("task-feedback-anchor");
    focusedAnchor = anchor || null;
    if (!anchor) return;
    anchor.classList.add("task-feedback-anchor");
    if (autoScroll && !inViewport(anchor)) {
      requestAnimationFrame(() => anchor.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  }

  function busyButton(button, label = "处理中…") {
    if (!button) return;
    if (!buttons.has(button)) buttons.set(button, { text: button.textContent, disabled: button.disabled });
    button.classList.add("is-task-busy");
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    if (label) button.textContent = label;
  }

  function restoreButton(button) {
    const previous = buttons.get(button);
    if (!button || !previous) return;
    button.classList.remove("is-task-busy");
    button.removeAttribute("aria-busy");
    button.textContent = previous.text;
    button.disabled = previous.disabled;
    buttons.delete(button);
  }

  function restoreAllButtons() {
    for (const button of [...buttons.keys()]) restoreButton(button);
  }

  function reveal() {
    root.hidden = false;
    root.classList.remove("is-collapsed");
    root.classList.add("is-visible");
    ui.collapse.textContent = "−";
    ui.collapse.setAttribute("aria-label", "收起任务进度");
  }

  function start({
    id = `task-${Date.now()}`,
    title = "正在处理",
    detail = "操作已开始，请稍候。",
    stage = "准备任务",
    step = 0,
    stepLabels = null,
    current = null,
    total = null,
    progress = null,
    indeterminate = progress === null && !(Number.isFinite(Number(current)) && Number.isFinite(Number(total))),
    button = null,
    buttonLabel = "处理中…",
    anchor = null,
    autoStages = [],
  } = {}) {
    clearTimers();
    restoreAllButtons();
    state = { id, startedAt: Date.now(), current, total, status: "running", stepLabels };
    root.dataset.state = "running";
    document.body.setAttribute("aria-busy", "true");
    reveal();
    ui.title.textContent = safeText(title, "正在处理");
    ui.detail.textContent = safeText(detail, "操作已开始，请稍候。");
    ui.stage.textContent = safeText(stage, "正在准备");
    ui.counts.textContent = Number.isFinite(Number(current)) && Number.isFinite(Number(total)) ? `${current}/${total}` : "";
    setStep(step, stepLabels);
    setProgress(progress ?? progressFromCounts(current, total), indeterminate);
    busyButton(button, buttonLabel);
    focusAnchor(anchor);
    updateClock();
    clock = setInterval(updateClock, 1000);
    stageTimers = autoStages.map((item) => setTimeout(() => {
      if (state?.id !== id || state.status !== "running") return;
      update(item);
    }, Math.max(0, Number(item.after || 0))));
    return id;
  }

  function update({
    title,
    detail,
    stage,
    step,
    stepLabels,
    current,
    total,
    progress,
    indeterminate,
    anchor,
  } = {}) {
    if (!state) start({ title, detail, stage, step, stepLabels, current, total, progress, indeterminate, anchor });
    if (title !== undefined) ui.title.textContent = safeText(title, ui.title.textContent);
    if (detail !== undefined) ui.detail.textContent = safeText(detail, ui.detail.textContent);
    if (stage !== undefined) ui.stage.textContent = safeText(stage, ui.stage.textContent);
    if (current !== undefined) state.current = current;
    if (total !== undefined) state.total = total;
    if (stepLabels) state.stepLabels = stepLabels;
    if (step !== undefined || stepLabels) setStep(step ?? 1, state.stepLabels);
    const countable = Number.isFinite(Number(state.current)) && Number.isFinite(Number(state.total));
    ui.counts.textContent = countable ? `${state.current}/${state.total}` : "";
    if (progress !== undefined || current !== undefined || total !== undefined || indeterminate !== undefined) {
      setProgress(progress ?? progressFromCounts(state.current, state.total), indeterminate ?? !countable);
    }
    if (anchor) focusAnchor(anchor);
    updateClock();
  }

  function settle(status, { title, detail, stage, step = 3, progress = 100, keepMs = 8000, button = null } = {}) {
    if (!state) state = { id: `task-${Date.now()}`, startedAt: Date.now() };
    clearTimers();
    state.status = status;
    root.dataset.state = status;
    document.body.removeAttribute("aria-busy");
    reveal();
    if (title) ui.title.textContent = title;
    if (detail) ui.detail.textContent = detail;
    ui.stage.textContent = stage || ({ success: "已完成", error: "需要处理", paused: "已暂停" }[status] || status);
    setStep(step, state.stepLabels);
    setProgress(status === "error" ? clampTaskProgress(progress) ?? 0 : progress, false);
    ui.eta.textContent = "";
    updateClock();
    if (button) restoreButton(button);
    else restoreAllButtons();
    if (focusedAnchor) {
      setTimeout(() => focusedAnchor?.classList.remove("task-feedback-anchor"), 1200);
      focusedAnchor = null;
    }
    if (keepMs > 0) dismissTimer = setTimeout(() => root.classList.add("is-collapsed"), keepMs);
  }

  function currentProgress() {
    return progressFromCounts(state?.current, state?.total) ?? 0;
  }
  function success(options = {}) { settle("success", { progress: 100, ...options }); }
  function fail(options = {}) { settle("error", { progress: currentProgress(), ...options }); }
  function pause(options = {}) { settle("paused", { step: 1, progress: currentProgress(), keepMs: 0, ...options }); }

  function clear() {
    clearTimers();
    restoreAllButtons();
    if (focusedAnchor) focusedAnchor.classList.remove("task-feedback-anchor");
    focusedAnchor = null;
    state = null;
    document.body.removeAttribute("aria-busy");
    root.classList.remove("is-visible", "is-collapsed");
    root.hidden = true;
  }

  async function run(options, worker) {
    const taskId = start(options);
    try {
      const result = await worker({ update, taskId });
      success({
        title: options.successTitle || "操作完成",
        detail: options.successDetail || "结果已经生成。",
        button: options.button,
      });
      return result;
    } catch (error) {
      fail({
        title: options.errorTitle || "操作未完成",
        detail: error instanceof Error ? error.message : String(error),
        button: options.button,
      });
      throw error;
    }
  }

  ui.collapse.addEventListener("click", () => {
    const collapsed = root.classList.toggle("is-collapsed");
    ui.collapse.textContent = collapsed ? "+" : "−";
    ui.collapse.setAttribute("aria-label", collapsed ? "展开任务进度" : "收起任务进度");
  });

  const controller = {
    start,
    update,
    success,
    fail,
    pause,
    clear,
    restoreButton,
    run,
    get active() { return state?.status === "running"; },
    get state() { return state ? { ...state } : null; },
  };
  if (!compact) globalThis.__KV_TASK_FEEDBACK__ = controller;
  return controller;
}
