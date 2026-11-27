import { crc32 } from "./zip.js";

const decoder = new TextDecoder("utf-8");
const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (view, offset) => view.getUint16(offset, true);
const u32 = (view, offset) => view.getUint32(offset, true);

function findEndOfCentralDirectory(bytes) {
  const view = viewOf(bytes);
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (u32(view, offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP 目录损坏或不受支持");
}

async function inflateRaw(bytes, expectedSize) {
  if (typeof DecompressionStream !== "function") throw new Error("当前浏览器不支持解压 deflate ZIP");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > expectedSize) {
        await reader.cancel();
        throw new Error("ZIP 解压大小超过目录声明");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function readZipEntries(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxEntries = options.maxEntries ?? 100_000;
  const maxUncompressedBytes = options.maxUncompressedBytes ?? 2 * 1024 * 1024 * 1024;
  const view = viewOf(bytes);
  const eocd = findEndOfCentralDirectory(bytes);
  const diskNumber = u16(view, eocd + 4);
  const centralDisk = u16(view, eocd + 6);
  const entryCount = u16(view, eocd + 10);
  const centralOffset = u32(view, eocd + 16);
  const centralEnd = centralOffset + u32(view, eocd + 12);
  if (diskNumber !== 0 || centralDisk !== 0 || entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("暂不支持 ZIP64 或跨磁盘 ZIP；请使用 ContextVault 分卷或较小的官方导出包");
  }
  if (entryCount > maxEntries) throw new Error(`ZIP 文件条目过多：${entryCount}`);

  if (centralEnd > eocd) throw new Error("ZIP 中央目录大小无效");
  const entries = new Map();
  const seen = new Set();
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralEnd || u32(view, cursor) !== 0x02014b50) throw new Error("ZIP 中央目录条目损坏");
    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const expectedCrc = u32(view, cursor + 16);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decoder.decode(nameBytes).replaceAll("\\", "/");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (cursor > centralEnd) throw new Error("ZIP 中央目录条目长度无效");
    if (!name || name.endsWith("/")) continue;
    if (name.startsWith("/") || name.split("/").some((part) => part === "..")) throw new Error(`ZIP 包含不安全路径：${name}`);
    if (options.includeEntry && !options.includeEntry(name)) continue;
    if (seen.has(name)) throw new Error("ZIP 包含重复路径：" + name);
    seen.add(name);
    try {
      if (localOffset + 30 > centralOffset || u32(view, localOffset) !== 0x04034b50) throw new Error("ZIP 本地条目损坏：" + name);
      if ((flags & 0x0001) !== 0) throw new Error("暂不支持加密 ZIP：" + name);
      if (uncompressedSize > maxUncompressedBytes - totalUncompressed) throw new Error("解压数据超过本地资料库安全上限");
      const dataOffset = localOffset + 30 + u16(view, localOffset + 26) + u16(view, localOffset + 28);
      if (dataOffset + compressedSize > centralOffset) throw new Error("ZIP 条目超出数据区域：" + name);
      // Reserve the budget even for a subsequently corrupt entry, bounding partial reads.
      totalUncompressed += uncompressedSize;
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      let data;
      if (method === 0 && compressedSize === uncompressedSize) data = compressed.slice();
      else if (method === 8) data = await inflateRaw(compressed, uncompressedSize);
      else if (method === 0) throw new Error("ZIP 解压大小不匹配：" + name);
      else throw new Error("ZIP 使用了不支持的压缩算法 " + method + "：" + name);
      if (data.length !== uncompressedSize) throw new Error("ZIP 解压大小不匹配：" + name);
      if (crc32(data) !== expectedCrc) throw new Error("ZIP CRC 校验失败：" + name);
      entries.set(name, data);
    } catch (error) {
      if (!options.onEntryError) throw error;
      options.onEntryError(name, error);
    }
  }
  return entries;
}

export function decodeZipText(bytes) {
  return decoder.decode(bytes);
}
