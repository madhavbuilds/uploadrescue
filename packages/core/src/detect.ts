import {
  EXTENSION_TO_MIME,
  categoryForMime,
  extensionForMime,
  getExtension,
  mimeFromExtension,
  normalizeMime,
  type FileCategory,
} from "./mime";

/**
 * How the detected type was established:
 * - `signature`: magic bytes in the file content (most trustworthy)
 * - `declared`: the browser-provided `File.type`
 * - `extension`: the file name extension
 * - `none`: nothing usable
 */
export type DetectionSource = "signature" | "declared" | "extension" | "none";

export interface DetectedType {
  mime: string;
  extension: string;
  category: FileCategory;
  source: DetectionSource;
}

export interface FileInfo {
  name: string;
  size: number;
  /** `File.type` as reported by the browser (may be empty or wrong). */
  declaredType: string;
  lastModified: number;
  detected: DetectedType;
  /**
   * True when the content signature contradicts the declared type or extension
   * (e.g. a PDF renamed to `.jpg`).
   */
  typeMismatch: boolean;
}

const HEAD_BYTES = 8192;
const ZIP_TAIL_BYTES = 65_536;

function bytesEqual(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (bytes[offset + i] !== expected[i]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  const end = Math.min(bytes.length, offset + length);
  for (let i = offset; i < end; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

function latin1(bytes: Uint8Array): string {
  // Chunked to avoid call stack limits on large inputs.
  let out = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    out += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return out;
}

function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 1024);
  for (let i = 0; i < n; i += 1) {
    const b = bytes[i]!;
    if (b === 0) return false;
  }
  return n > 0;
}

const SVG_PATTERN =
  /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

function sniffFtyp(bytes: Uint8Array): string | null {
  if (ascii(bytes, 4, 4) !== "ftyp") return null;
  const major = ascii(bytes, 8, 4);
  // Compatible brands follow the minor version (offset 16..box size).
  const boxSize = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  const compat: string[] = [];
  for (let o = 16; o + 4 <= Math.min(boxSize, bytes.length, 256); o += 4)
    compat.push(ascii(bytes, o, 4));
  const brands = [major, ...compat];
  if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(major)) return "image/heic";
  if (major === "qt  ") return "video/quicktime";
  if (major === "M4A " || major === "M4B ") return "audio/mp4";
  if (major.startsWith("3g")) return "video/3gpp";
  return "video/mp4";
}

function sniffZip(head: Uint8Array, tail: Uint8Array | null): string {
  const haystack = latin1(head) + (tail ? latin1(tail) : "");
  if (haystack.includes("[Content_Types].xml")) {
    const macro = haystack.includes("vbaProject.bin");
    if (haystack.includes("word/")) return EXTENSION_TO_MIME[macro ? "docm" : "docx"]!;
    if (haystack.includes("xl/")) return EXTENSION_TO_MIME[macro ? "xlsm" : "xlsx"]!;
    if (haystack.includes("ppt/")) return EXTENSION_TO_MIME[macro ? "pptm" : "pptx"]!;
  }
  return "application/zip";
}

/**
 * Identifies a file type from its leading bytes. Returns null when no known
 * signature matches. `tail` is only used to disambiguate ZIP-based formats.
 */
export function sniffMime(head: Uint8Array, tail: Uint8Array | null = null): string | null {
  const b = head;
  if (bytesEqual(b, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytesEqual(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF") {
    const kind = ascii(b, 8, 4);
    if (kind === "WEBP") return "image/webp";
    if (kind === "WAVE") return "audio/wav";
    if (kind === "AVI ") return "video/x-msvideo";
  }
  if (ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  if (bytesEqual(b, 0, [0x50, 0x4b, 0x03, 0x04]) || bytesEqual(b, 0, [0x50, 0x4b, 0x05, 0x06])) {
    return sniffZip(b, tail);
  }
  if (bytesEqual(b, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return "application/x-cfb";
  if (bytesEqual(b, 0, [0x1f, 0x8b])) return "application/gzip";
  if (bytesEqual(b, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "application/x-7z-compressed";
  if (ascii(b, 0, 4) === "Rar!") return "application/vnd.rar";
  if (ascii(b, 0, 2) === "BM" && b.length > 14) return "image/bmp";
  if (bytesEqual(b, 0, [0x49, 0x49, 0x2a, 0x00]) || bytesEqual(b, 0, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "image/tiff";
  }
  const ftyp = sniffFtyp(b);
  if (ftyp) return ftyp;
  if (bytesEqual(b, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return latin1(b.subarray(0, 64)).includes("webm") ? "video/webm" : "video/x-matroska";
  }
  if (ascii(b, 0, 3) === "ID3") return "audio/mpeg";
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0) {
    // MPEG audio frame sync (layer bits must not be 00).
    return "audio/mpeg";
  }
  if (ascii(b, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(b, 0, 4) === "fLaC") return "audio/flac";
  if (looksLikeText(b)) {
    const text = latin1(b.subarray(0, 4096));
    if (SVG_PATTERN.test(text)) return "image/svg+xml";
  }
  return null;
}

async function readRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/**
 * Determines the type of a file from its content, falling back to the declared
 * type and then the extension. Reads at most ~72 KB regardless of file size.
 */
export async function detectFileType(file: Blob & { name?: string }): Promise<DetectedType> {
  const name = file.name ?? "";
  const head = await readRange(file, 0, HEAD_BYTES);
  let tail: Uint8Array | null = null;
  if (bytesEqual(head, 0, [0x50, 0x4b]) && file.size > HEAD_BYTES) {
    tail = await readRange(file, Math.max(HEAD_BYTES, file.size - ZIP_TAIL_BYTES), file.size);
  }
  const sniffed = sniffMime(head, tail);
  if (sniffed) {
    return {
      mime: sniffed,
      extension: extensionForMime(sniffed) ?? getExtension(name),
      category: categoryForMime(sniffed),
      source: "signature",
    };
  }
  const declared = file.type ? normalizeMime(file.type) : "";
  if (declared && declared !== "application/octet-stream") {
    return {
      mime: declared,
      extension: getExtension(name) || extensionForMime(declared) || "",
      category: categoryForMime(declared),
      source: "declared",
    };
  }
  const fromExt = mimeFromExtension(name);
  if (fromExt) {
    return {
      mime: fromExt,
      extension: getExtension(name),
      category: categoryForMime(fromExt),
      source: "extension",
    };
  }
  return {
    mime: "application/octet-stream",
    extension: getExtension(name),
    category: "unknown",
    source: "none",
  };
}

// Formats whose signature legitimately differs from the extension's canonical MIME.
const COMPATIBLE: ReadonlyArray<readonly [string, string]> = [
  ["application/zip", "application/vnd.openxmlformats-officedocument"],
  ["video/mp4", "video/quicktime"],
  ["video/mp4", "audio/mp4"],
  ["image/heic", "image/heif"],
  ["video/x-matroska", "video/webm"],
];

function compatible(a: string, b: string): boolean {
  if (a === b) return true;
  return COMPATIBLE.some(
    ([x, y]) => (a.startsWith(x) && b.startsWith(y)) || (a.startsWith(y) && b.startsWith(x)),
  );
}

/** Extracts metadata and the detected type of a file without reading it fully. */
export async function inspectFile(file: File): Promise<FileInfo> {
  const detected = await detectFileType(file);
  let typeMismatch = false;
  if (detected.source === "signature") {
    const declared = file.type ? normalizeMime(file.type) : "";
    const fromExt = mimeFromExtension(file.name) ?? "";
    if (
      declared &&
      declared !== "application/octet-stream" &&
      !compatible(declared, detected.mime)
    ) {
      typeMismatch = true;
    } else if (fromExt && !compatible(fromExt, detected.mime)) {
      typeMismatch = true;
    }
  }
  return {
    name: file.name,
    size: file.size,
    declaredType: file.type,
    lastModified: file.lastModified,
    detected,
    typeMismatch,
  };
}
