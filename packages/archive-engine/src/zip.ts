/**
 * Minimal, defensive ZIP reader/writer.
 *
 * - Parses the central directory only; never trusts local headers for sizes.
 * - Enforces entry-count, size, ratio and path limits *before* decompressing.
 * - Inflates in small input chunks and aborts as soon as output exceeds the
 *   declared size, so compression bombs cannot allocate unbounded memory.
 * - Never writes anything to disk; everything stays in memory.
 */
import { Inflate, deflateSync } from "fflate";

export interface ZipLimits {
  /** Maximum number of entries. Default 10 000. */
  maxEntries: number;
  /** Maximum declared + actual uncompressed size of all entries. Default 512 MiB. */
  maxTotalUncompressed: number;
  /** Maximum uncompressed size of one entry. Default 256 MiB. */
  maxEntryUncompressed: number;
  /** Maximum uncompressed/compressed ratio for entries over 1 MiB. Default 200. */
  maxCompressionRatio: number;
  /** Maximum entry name length. Default 1024. */
  maxNameLength: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxTotalUncompressed: 512 * 1024 * 1024,
  maxEntryUncompressed: 256 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxNameLength: 1024,
};

export type ArchiveErrorCode =
  | "not-zip"
  | "corrupt"
  | "zip64-unsupported"
  | "too-many-entries"
  | "too-large"
  | "ratio-exceeded"
  | "unsafe-path"
  | "duplicate-entry"
  | "encrypted"
  | "unsupported-method"
  | "crc-mismatch";

export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode;
  readonly entry: string | undefined;
  constructor(code: ArchiveErrorCode, message: string, entry?: string) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
    this.entry = entry;
  }
}

export interface ZipEntry {
  name: string;
  /** Raw name bytes, preserved exactly when repacking. */
  nameBytes: Uint8Array;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataOffset: number;
  modTime: number;
  modDate: number;
  versionMadeBy: number;
  internalAttrs: number;
  externalAttrs: number;
  isDirectory: boolean;
  encrypted: boolean;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// ---------------------------------------------------------------- CRC-32

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- reading

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const utf8 = new TextDecoder("utf-8", { fatal: false });
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

/** Rejects absolute paths, drive letters, `..` segments, NUL bytes and over-long names. */
export function assertSafeEntryName(
  name: string,
  limits: Pick<ZipLimits, "maxNameLength"> = DEFAULT_ZIP_LIMITS,
): void {
  const normalized = name.replace(/\\/g, "/");
  const unsafe =
    name.length === 0 ||
    name.length > limits.maxNameLength ||
    name.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..");
  if (unsafe)
    throw new ArchiveError(
      "unsafe-path",
      `Unsafe entry path: ${JSON.stringify(name.slice(0, 200))}`,
      name,
    );
}

function findEocd(dv: DataView): number {
  const min = Math.max(0, dv.byteLength - 22 - 0xffff);
  for (let i = dv.byteLength - 22; i >= min; i -= 1) {
    if (dv.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

/** Parses and validates the central directory. Does not decompress anything. */
export function readZipDirectory(
  bytes: Uint8Array,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): ZipEntry[] {
  if (bytes.length < 22)
    throw new ArchiveError("not-zip", "The file is too small to be a ZIP archive.");
  const dv = view(bytes);
  const eocd = findEocd(dv);
  if (eocd < 0) throw new ArchiveError("not-zip", "No ZIP end-of-central-directory record found.");
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ArchiveError("zip64-unsupported", "ZIP64 archives are not supported.");
  }
  if (total > limits.maxEntries) {
    throw new ArchiveError(
      "too-many-entries",
      `The archive has ${total} entries (limit ${limits.maxEntries}).`,
    );
  }
  if (cdOffset + cdSize > eocd)
    throw new ArchiveError("corrupt", "The central directory is out of bounds.");

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let declaredTotal = 0;
  let p = cdOffset;
  for (let i = 0; i < total; i += 1) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CENTRAL) {
      throw new ArchiveError("corrupt", "Invalid central directory entry.");
    }
    const flags = dv.getUint16(p + 8, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const nameBytes = bytes.slice(p + 46, p + 46 + nameLen);
    const name = flags & 0x0800 ? utf8.decode(nameBytes) : latin1(nameBytes);
    const entry: ZipEntry = {
      name,
      nameBytes,
      versionMadeBy: dv.getUint16(p + 4, true),
      flags,
      method: dv.getUint16(p + 10, true),
      modTime: dv.getUint16(p + 12, true),
      modDate: dv.getUint16(p + 14, true),
      crc32: dv.getUint32(p + 16, true),
      compressedSize: dv.getUint32(p + 20, true),
      uncompressedSize: dv.getUint32(p + 24, true),
      internalAttrs: dv.getUint16(p + 36, true),
      externalAttrs: dv.getUint32(p + 38, true),
      localHeaderOffset: dv.getUint32(p + 42, true),
      dataOffset: 0,
      isDirectory: name.endsWith("/"),
      encrypted: (flags & 0x0001) !== 0,
    };
    if (
      entry.compressedSize === 0xffffffff ||
      entry.uncompressedSize === 0xffffffff ||
      entry.localHeaderOffset === 0xffffffff
    ) {
      throw new ArchiveError("zip64-unsupported", "ZIP64 entries are not supported.", name);
    }
    assertSafeEntryName(name, limits);
    if (names.has(name))
      throw new ArchiveError("duplicate-entry", `Duplicate entry: ${name}`, name);
    names.add(name);

    if (entry.uncompressedSize > limits.maxEntryUncompressed) {
      throw new ArchiveError("too-large", `Entry ${name} is too large when uncompressed.`, name);
    }
    declaredTotal += entry.uncompressedSize;
    if (declaredTotal > limits.maxTotalUncompressed) {
      throw new ArchiveError("too-large", "The archive is too large when uncompressed.");
    }
    if (
      entry.uncompressedSize > 1024 * 1024 &&
      entry.uncompressedSize / Math.max(1, entry.compressedSize) > limits.maxCompressionRatio
    ) {
      throw new ArchiveError(
        "ratio-exceeded",
        `Entry ${name} has a suspicious compression ratio.`,
        name,
      );
    }

    const lh = entry.localHeaderOffset;
    if (lh + 30 > bytes.length || dv.getUint32(lh, true) !== SIG_LOCAL) {
      throw new ArchiveError("corrupt", `Invalid local header for ${name}.`, name);
    }
    entry.dataOffset = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
    if (entry.dataOffset + entry.compressedSize > bytes.length) {
      throw new ArchiveError("corrupt", `Entry ${name} extends beyond the end of the file.`, name);
    }
    entries.push(entry);
    p += 46 + nameLen + extraLen + commentLen;
  }
  // Overlapping entries ("non-recursive" zip bombs) reuse one compressed
  // stream for many entries. Legitimate archives never overlap.
  const sorted = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    if (prev.dataOffset + prev.compressedSize > sorted[i]!.localHeaderOffset) {
      throw new ArchiveError(
        "corrupt",
        `Entries ${prev.name} and ${sorted[i]!.name} overlap.`,
        sorted[i]!.name,
      );
    }
  }
  return entries;
}

/** Raw (still compressed) bytes of an entry. */
export function rawEntryData(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  return bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
}

const INFLATE_CHUNK = 16 * 1024;

/** Decompresses one entry with bounded memory and verifies size and CRC. */
export function extractEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Uint8Array {
  if (entry.encrypted)
    throw new ArchiveError("encrypted", `Entry ${entry.name} is encrypted.`, entry.name);
  const raw = rawEntryData(bytes, entry);
  let out: Uint8Array;
  if (entry.method === 0) {
    out = raw;
  } else if (entry.method === 8) {
    const limit = Math.min(entry.uncompressedSize, limits.maxEntryUncompressed);
    out = new Uint8Array(limit);
    let written = 0;
    let overflow = false;
    const inflater = new Inflate();
    inflater.ondata = (chunk) => {
      if (written + chunk.length > limit) {
        overflow = true;
        return;
      }
      out.set(chunk, written);
      written += chunk.length;
    };
    for (let i = 0; i < raw.length && !overflow; i += INFLATE_CHUNK) {
      const end = Math.min(raw.length, i + INFLATE_CHUNK);
      try {
        inflater.push(raw.subarray(i, end), end === raw.length);
      } catch (error) {
        throw new ArchiveError(
          "corrupt",
          `Entry ${entry.name} could not be decompressed: ${(error as Error).message}`,
          entry.name,
        );
      }
    }
    if (overflow) {
      throw new ArchiveError(
        "ratio-exceeded",
        `Entry ${entry.name} decompresses beyond its declared size.`,
        entry.name,
      );
    }
    out = out.subarray(0, written);
  } else {
    throw new ArchiveError(
      "unsupported-method",
      `Entry ${entry.name} uses unsupported compression method ${entry.method}.`,
      entry.name,
    );
  }
  if (out.length !== entry.uncompressedSize) {
    throw new ArchiveError(
      "corrupt",
      `Entry ${entry.name} has the wrong uncompressed size.`,
      entry.name,
    );
  }
  if (crc32(out) !== entry.crc32)
    throw new ArchiveError("crc-mismatch", `CRC mismatch in ${entry.name}.`, entry.name);
  return out;
}

// ---------------------------------------------------------------- writing

export interface ZipWriteEntry {
  nameBytes: Uint8Array;
  /** 0 = stored, 8 = deflate. `data` must already be in that form. */
  method: 0 | 8;
  data: Uint8Array;
  crc32: number;
  uncompressedSize: number;
  modTime: number;
  modDate: number;
  utf8: boolean;
  versionMadeBy: number;
  internalAttrs: number;
  externalAttrs: number;
}

/** Writes a ZIP archive (no ZIP64, no data descriptors, no extra fields). */
export function writeZip(entries: readonly ZipWriteEntry[]): Uint8Array {
  let size = 22;
  for (const e of entries)
    size += 30 + e.nameBytes.length + e.data.length + 46 + e.nameBytes.length;
  if (size > 0xffffffff || entries.length > 0xfffe) {
    throw new ArchiveError("zip64-unsupported", "Output would require ZIP64.");
  }
  const out = new Uint8Array(size);
  const dv = view(out);
  let p = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(p);
    const flags = e.utf8 ? 0x0800 : 0;
    const version = e.method === 8 ? 20 : 10;
    dv.setUint32(p, SIG_LOCAL, true);
    dv.setUint16(p + 4, version, true);
    dv.setUint16(p + 6, flags, true);
    dv.setUint16(p + 8, e.method, true);
    dv.setUint16(p + 10, e.modTime, true);
    dv.setUint16(p + 12, e.modDate, true);
    dv.setUint32(p + 14, e.crc32, true);
    dv.setUint32(p + 18, e.data.length, true);
    dv.setUint32(p + 22, e.uncompressedSize, true);
    dv.setUint16(p + 26, e.nameBytes.length, true);
    dv.setUint16(p + 28, 0, true);
    out.set(e.nameBytes, p + 30);
    out.set(e.data, p + 30 + e.nameBytes.length);
    p += 30 + e.nameBytes.length + e.data.length;
  }
  const cdStart = p;
  entries.forEach((e, i) => {
    const flags = e.utf8 ? 0x0800 : 0;
    dv.setUint32(p, SIG_CENTRAL, true);
    dv.setUint16(p + 4, e.versionMadeBy, true);
    dv.setUint16(p + 6, e.method === 8 ? 20 : 10, true);
    dv.setUint16(p + 8, flags, true);
    dv.setUint16(p + 10, e.method, true);
    dv.setUint16(p + 12, e.modTime, true);
    dv.setUint16(p + 14, e.modDate, true);
    dv.setUint32(p + 16, e.crc32, true);
    dv.setUint32(p + 20, e.data.length, true);
    dv.setUint32(p + 24, e.uncompressedSize, true);
    dv.setUint16(p + 28, e.nameBytes.length, true);
    dv.setUint16(p + 30, 0, true);
    dv.setUint16(p + 32, 0, true);
    dv.setUint16(p + 34, 0, true);
    dv.setUint16(p + 36, e.internalAttrs, true);
    dv.setUint32(p + 38, e.externalAttrs, true);
    dv.setUint32(p + 42, offsets[i]!, true);
    out.set(e.nameBytes, p + 46);
    p += 46 + e.nameBytes.length;
  });
  dv.setUint32(p, SIG_EOCD, true);
  dv.setUint16(p + 8, entries.length, true);
  dv.setUint16(p + 10, entries.length, true);
  dv.setUint32(p + 12, p - cdStart, true);
  dv.setUint32(p + 16, cdStart, true);
  return out;
}

// ---------------------------------------------------------------- repacking

export interface RepackOptions {
  limits?: ZipLimits;
  /** Deflate level 1–9. Default 9. */
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /**
   * Optional content transform (e.g. recompress embedded media). Return null
   * to keep the entry unchanged. Called only for files, never directories.
   */
  transform?: (entry: ZipEntry, data: Uint8Array) => Promise<Uint8Array | null>;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

export interface RepackStats {
  entries: number;
  recompressed: number;
  transformed: number;
  keptOriginal: number;
}

/**
 * Rewrites an archive with maximum deflate compression, keeping each entry's
 * original compressed bytes whenever they are already smaller. Entry order,
 * names, timestamps and attributes are preserved; content is unchanged unless
 * `transform` replaces it. The output is re-read and CRC-verified.
 */
export async function repackZip(
  bytes: Uint8Array,
  options: RepackOptions = {},
): Promise<{ bytes: Uint8Array; stats: RepackStats }> {
  const limits = options.limits ?? DEFAULT_ZIP_LIMITS;
  const entries = readZipDirectory(bytes, limits);
  const stats: RepackStats = {
    entries: entries.length,
    recompressed: 0,
    transformed: 0,
    keptOriginal: 0,
  };
  const output: ZipWriteEntry[] = [];
  const expectedCrc = new Map<string, number>();
  let actualTotal = 0;

  for (const [index, entry] of entries.entries()) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const base = {
      nameBytes: entry.nameBytes,
      modTime: entry.modTime,
      modDate: entry.modDate,
      utf8: (entry.flags & 0x0800) !== 0,
      versionMadeBy: entry.versionMadeBy,
      internalAttrs: entry.internalAttrs,
      externalAttrs: entry.externalAttrs,
    };
    if (entry.isDirectory) {
      output.push({ ...base, method: 0, data: new Uint8Array(0), crc32: 0, uncompressedSize: 0 });
      continue;
    }
    let data = extractEntry(bytes, entry, limits);
    actualTotal += data.length;
    if (actualTotal > limits.maxTotalUncompressed)
      throw new ArchiveError("too-large", "The archive is too large when uncompressed.");

    let crc = entry.crc32;
    let changed = false;
    if (options.transform) {
      const replaced = await options.transform(entry, data);
      if (replaced && replaced.length < data.length) {
        data = replaced;
        crc = crc32(data);
        changed = true;
        stats.transformed += 1;
      }
    }
    expectedCrc.set(entry.name, crc);

    // EPUB / ODF require a stored, first `mimetype` entry.
    const mustStore = index === 0 && entry.name === "mimetype";
    const deflated = mustStore ? null : deflateSync(data, { level: options.level ?? 9 });
    const original =
      !changed && (entry.method === 0 || entry.method === 8) ? rawEntryData(bytes, entry) : null;

    let choice: { method: 0 | 8; data: Uint8Array } = { method: 0, data };
    if (deflated && deflated.length < choice.data.length) choice = { method: 8, data: deflated };
    if (original && !mustStore && original.length <= choice.data.length) {
      choice = { method: entry.method as 0 | 8, data: original };
      stats.keptOriginal += 1;
    } else if (choice.method === 8) {
      stats.recompressed += 1;
    }
    output.push({ ...base, ...choice, crc32: crc, uncompressedSize: data.length });
    options.onProgress?.((index + 1) / entries.length);
  }

  const result = writeZip(output);
  // Verify: the output parses and every entry decompresses to the expected CRC.
  const verifyEntries = readZipDirectory(result, limits);
  if (verifyEntries.length !== entries.length)
    throw new ArchiveError("corrupt", "Repacked archive lost entries.");
  for (const e of verifyEntries) {
    if (e.isDirectory) continue;
    extractEntry(result, e, limits);
    if (expectedCrc.get(e.name) !== e.crc32)
      throw new ArchiveError("crc-mismatch", `Repacked entry ${e.name} differs.`, e.name);
  }
  return { bytes: result, stats };
}
