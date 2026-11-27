import { commitImportPlan, previewImportArchives } from "./vault-import.js";

const escape = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const number = (value) => new Intl.NumberFormat("zh-CN").format(value || 0);
const metric = (label, value) => "<div><strong>" + number(value) + "</strong>" + label + "</div>";
const issueLabel = { file: "文件", shard: "分卷 / 条目", record: "记录", write: "写入" };

function fileLedger(rows, committed) {
  return '<div class="import-ledger">' + rows.map((row) => {
    const readySummary = number(row.records) + " 条已识别 · " + number(row.ready) + " 条" + (committed ? "通过预检" : "可导入");
    const excluded = row.records - row.ready;
    const otherSummary = (excluded ? " · " + number(excluded) + " 条异常" : "") + (row.ignoredEntries ? " · " + number(row.ignoredEntries) + " 个非会话条目未导入" : "");
    const outcomes = committed ? "<p>新增 " + number(row.inserted) + " · 更新 " + number(row.updated) + " · 重复 " + number(row.duplicate) + " · 旧版 " + number(row.stale) + " · 写入失败 " + number(row.failed) + (row.preservedProject ? " · 保留原项目 " + number(row.preservedProject) : "") + "</p>" : "";
    const issues = row.issues.length ? '<ul class="file-warning">' + row.issues.map(({unit, entryPath, recordNumber, reason}) => "<li>" + escape([issueLabel[unit] || unit, entryPath, recordNumber == null ? null : "第 " + recordNumber + " 条", reason].filter(Boolean).join(" · ")) + "</li>").join("") + "</ul>" : "<p>未发现阻塞此文件的异常。</p>";
    return "<details" + (row.issues.length ? " open" : "") + '><summary><span>' + row.fileNumber + ". " + escape(row.name) + "</span><small>" + readySummary + otherSummary + "</small></summary><div>" + outcomes + issues + "</div></details>";
  }).join("") + "</div>";
}

function overview(title, tone, description, metrics, detail = "") {
  return '<section class="import-overview" data-tone="' + tone + '"><h3 tabindex="-1">' + title + '</h3><p class="receipt-description">' + description + '</p><div class="import-metrics">' + metrics.join("") + "</div>" + detail + "</section>";
}

function renderPlan(plan) {
  const problems = plan.rejected || plan.blockedUnits;
  return overview(plan.ready ? "预检完成，尚未写入" : "没有可导入记录", plan.ready ? (problems ? "attention" : "ok") : "error",
    plan.ready ? "确认后才写入。异常分卷和记录会跳过；文件里其他资料（包括附件）不会入库。" : "请核对下方文件问题，再选合适的导出包；资料库没有写入。",
    [metric("文件", plan.files), metric("已读对话", plan.records), metric("可导入", plan.ready), metric("异常记录", plan.rejected), metric("阻塞文件／条目", plan.blockedUnits)],
    fileLedger(plan.inputFiles, false));
}

function renderReceipt(report) {
  const status = { complete: "入库对账完成", partial: "已入库 · 有异常待核对", failed: "本批未成功入库" }[report.status] || "导入回执";
  const tone = report.status === "complete" ? "ok" : report.status === "partial" ? "attention" : "error";
  const description = "已读 " + number(report.total) + " 条对话，其中 " + number(report.ready) + " 条通过预检。损坏条目的记录数无法确定，不算作 0 条对话。";
  const warning = report.receiptStored ? "" : '<p class="receipt-warning">写入结果已核对，但回执未能存进资料库。请下载这份 JSON。' + escape(report.receiptError) + "</p>";
  return overview(status, tone, description, [
    metric("新增", report.inserted), metric("更新", report.updated), metric("重复", report.duplicate),
    metric("旧版", report.stale), metric("异常记录", report.rejected), metric("写入失败", report.failed),
    metric("阻塞文件／条目", report.blockedUnits), ...(report.preservedProject ? [metric("保留原项目", report.preservedProject)] : []),
  ], warning + fileLedger(report.inputFiles, true));
}

export function createLibraryImportUi({ store, onCommitted = () => {}, onNotice = () => {} }) {
  const byId = (id) => document.getElementById(id);
  const dialog = byId("import-dialog");
  const picker = byId("import-pick");
  const input = byId("files");
  const output = byId("import-output");
  const live = byId("import-live");
  const footer = byId("import-footer");
  const confirm = byId("import-confirm");
  const download = byId("import-download");
  const close = byId("import-close");
  const reset = byId("import-reset");
  const latestButton = byId("latest-import-receipt");
  const steps = [...dialog.querySelectorAll("[data-import-step]")];
  const drop = byId("import-drop");
  let plan = null;
  let report = null;
  let latest = null;
  let phase = "pick";
  let generation = 0;

  function setPhase(next) {
    phase = next;
    dialog.dataset.phase = next;
    const active = next === "reading" || next === "writing";
    const step = next === "reading" || next === "writing" ? "preview" : next;
    for (const el of steps) {
      if (el.dataset.importStep === step) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    }
    dialog.setAttribute("aria-busy", String(active));
    close.disabled = next === "writing";
    reset.disabled = next === "writing";
    picker.hidden = next !== "pick";
    live.hidden = !active;
    output.hidden = next === "pick" || next === "reading";
    footer.hidden = next === "pick" || next === "reading";
    confirm.hidden = next !== "preview" || !plan?.ready;
    download.hidden = next !== "receipt" || !report;
  }

  function resetPicker() {
    generation += 1;
    plan = report = null;
    input.value = "";
    output.replaceChildren();
    setPhase("pick");
  }

  function open() {
    if (dialog.open) return;
    resetPicker();
    dialog.showModal();
    byId("import-choose").focus();
  }

  function showReceipt(value) {
    plan = null;
    report = value;
    output.innerHTML = renderReceipt(value);
    setPhase("receipt");
    output.querySelector("h3")?.focus();
  }

  async function preview(fileList) {
    const files = Array.from(fileList);
    if (!files.length || phase !== "pick") return;
    input.value = "";
    const ticket = ++generation;
    live.textContent = "正在读文件，资料库不会写入。";
    setPhase("reading");
    // Let the dialog paint before parsing a local JSON file.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (ticket !== generation) return;
    try {
      const inspected = await previewImportArchives(files, {
        onFile({fileNumber}) {
          if (ticket === generation) live.textContent = "正在检查文件 " + fileNumber + " / " + files.length + "，未写入资料库。";
        },
      });
      if (ticket !== generation) return;
      plan = inspected;
      output.innerHTML = renderPlan(inspected);
      confirm.textContent = "确认导入 " + number(inspected.ready) + " 条";
    } catch {
      if (ticket !== generation) return;
      output.innerHTML = overview("未能完成预检", "error", "资料库没有写入。请重新选择导出文件。", []);
    }
    setPhase("preview");
    output.querySelector("h3")?.focus();
  }

  async function commit() {
    if (phase !== "preview" || !plan?.ready) return;
    setPhase("writing");
    byId("import-title").focus();
    live.textContent = "正在写入已通过预检的会话…";
    let value;
    try {
      value = await commitImportPlan({ plan, store, onProgress({phase: progressPhase, index, total}) {
        if (progressPhase === "indexing") live.textContent = "正在入库 " + index + " / " + total;
      } });
    } catch {
      plan = null;
      output.innerHTML = overview("未能完成本批对账", "error", "无法确认写入结果。可检查资料库并重新预检；已经提交的记录会在重导时去重。", []);
      setPhase("preview");
      output.querySelector("h3")?.focus();
      return;
    }
    latest = value;
    latestButton.hidden = false;
    showReceipt(value);
    onNotice(value.status === "complete" ? "已生成导入回执。" : "本批有未处理项，详见导入回执。", value.status === "failed" ? "error" : "");
    try { await onCommitted(value); }
    catch { onNotice("导入回执可用；列表刷新失败，请重新打开资料库。", "error"); }
  }

  byId("begin-import").addEventListener("click", open);
  byId("import-choose").addEventListener("click", () => input.click());
  input.addEventListener("change", () => preview(input.files));
  drop.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    drop.dataset.over = "";
  });
  drop.addEventListener("dragleave", (event) => { if (!drop.contains(event.relatedTarget)) delete drop.dataset.over; });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    delete drop.dataset.over;
    preview(event.dataTransfer.files);
  });
  reset.addEventListener("click", () => { resetPicker(); byId("import-choose").focus(); });
  confirm.addEventListener("click", commit);
  close.addEventListener("click", () => { if (phase !== "writing") dialog.close(); });
  dialog.addEventListener("cancel", (event) => { if (phase === "writing") event.preventDefault(); });
  dialog.addEventListener("close", resetPicker);
  latestButton.addEventListener("click", () => {
    if (!latest || dialog.open) return;
    dialog.showModal();
    showReceipt(latest);
  });
  download.addEventListener("click", () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + "\n"], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "kv-archive-import-" + report.finishedAt.replaceAll(":", "-") + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  async function restoreLatest() {
    try {
      const value = await store.getLatestImportReceipt();
      if (!latest && value) { latest = value; latestButton.hidden = false; }
    } catch { /* Import still works even if the previous receipt cannot be read. */ }
  }
  return { open, restoreLatest };
}
