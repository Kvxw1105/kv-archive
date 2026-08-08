const encoder = new TextEncoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (value) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
const u32 = (value) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);

export function concatBytes(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function dosDateTime(date) {
  const valid = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date("2000-01-01T00:00:00.000Z");
  const year = Math.max(1980, valid.getUTCFullYear());
  const time = (valid.getUTCHours() << 11) | (valid.getUTCMinutes() << 5) | Math.floor(valid.getUTCSeconds() / 2);
  const day = ((year - 1980) << 9) | ((valid.getUTCMonth() + 1) << 5) | valid.getUTCDate();
  return { time, day };
}

export function createStoredZip(entries, date = new Date("2000-01-01T00:00:00.000Z")) {
  if (!Array.isArray(entries) || entries.length > 65_535) throw new Error("ZIP entry limit exceeded");
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime(date);
  const names = new Set();
  for (const entry of entries) {
    const nameValue = String(entry?.name || "");
    if (!nameValue || nameValue.startsWith("/") || nameValue.includes("..") || nameValue.includes("\\")) throw new Error(`Unsafe ZIP path: ${nameValue}`);
    if (names.has(nameValue)) throw new Error(`Duplicate ZIP entry: ${nameValue}`);
    names.add(nameValue);
    const name = encoder.encode(nameValue);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    if (!(data instanceof Uint8Array)) throw new TypeError(`ZIP entry data must be a string or Uint8Array: ${nameValue}`);
    if (data.length > 0xffffffff) throw new Error(`ZIP entry is too large: ${nameValue}`);
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    localParts.push(local);
    centralParts.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
    if (offset > 0xffffffff) throw new Error("ZIP archive exceeds the non-ZIP64 size limit");
  }
  const central = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return concatBytes([...localParts, central, end]);
}
