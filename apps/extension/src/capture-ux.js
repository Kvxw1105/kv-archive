export function restoreUndoMode(item = {}) {
  if (item.status === "archived") return "archive";
  if (item.status === "trashed") return "trash";
  return "none";
}

export function relationSelectionState(ids = [], fromId = "", toId = "") {
  const values = [...new Set(ids.map(String).filter(Boolean))];
  if (values.length < 2) return { ready: false, fromId: values[0] || "", toId: "" };
  const from = values.includes(String(fromId)) ? String(fromId) : values[0];
  let to = values.includes(String(toId)) ? String(toId) : values[1];
  if (to === from) to = values.find((id) => id !== from) || "";
  return { ready: Boolean(from && to && from !== to), fromId: from, toId: to };
}
