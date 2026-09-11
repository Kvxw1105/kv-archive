const STATUS_PRESENTATION = Object.freeze({
  disabled: { label: "未开启", tone: "neutral" },
  idle: { label: "已开启", tone: "good" },
  running: { label: "正在备份", tone: "active" },
  waiting_for_idle: { label: "等待浏览器空闲", tone: "warning" },
  waiting_for_other_backup: { label: "等待其他任务", tone: "warning" },
  continuation_pending: { label: "后台继续中", tone: "active" },
  success: { label: "运行正常", tone: "good" },
  success_with_warnings: { label: "有待处理项", tone: "warning" },
  failed: { label: "需要处理", tone: "danger" },
});

export function scheduleStatusPresentation(status) {
  return STATUS_PRESENTATION[status] ?? { label: "状态未知", tone: "neutral" };
}

export function scheduleConfigurationSummary(settings = {}) {
  const days = Math.max(1, Math.floor(Number(settings.intervalDays) || 3));
  const interval = ({ 1: "每天", 3: "每 3 天", 7: "每周", 30: "每 30 天" })[days] ?? `每 ${days} 天`;
  const time = /^\d{2}:\d{2}$/.test(String(settings.localTime || "")) ? settings.localTime : "03:30";
  return `${interval} · ${time}${settings.idleOnly === false ? "" : " · 仅空闲时"}`;
}
