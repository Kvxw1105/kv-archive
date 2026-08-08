const encoder = new TextEncoder();

function normalizeForStableJson(value, seen) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    if (typeof value === "bigint") return value.toString();
    return value;
  }
  if (seen.has(value)) throw new TypeError("Cannot hash a circular value");
  seen.add(value);
  try {
    if (value instanceof Uint8Array) return { $bytes: Array.from(value) };
    if (value instanceof ArrayBuffer) return { $bytes: Array.from(new Uint8Array(value)) };
    if (Array.isArray(value)) return value.map((item) => normalizeForStableJson(item, seen));
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
      output[key] = normalizeForStableJson(item, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function stableStringify(value) {
  return JSON.stringify(normalizeForStableJson(value, new WeakSet()));
}

export function byteLengthOf(value) {
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value === "string") return encoder.encode(value).byteLength;
  return encoder.encode(stableStringify(value)).byteLength;
}

export async function sha256HexBytes(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexText(text) {
  return sha256HexBytes(encoder.encode(String(text ?? "")));
}

export async function hashStableJson(value) {
  return sha256HexText(stableStringify(value));
}

export async function contentObjectKey(kind, payload, knownHash = null) {
  const hash = knownHash || (payload instanceof Uint8Array || payload instanceof ArrayBuffer
    ? await sha256HexBytes(payload)
    : await hashStableJson(payload));
  return `${String(kind || "object")}:${hash}`;
}
