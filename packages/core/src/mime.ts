export type FileCategory =
  "image" | "pdf" | "document" | "archive" | "video" | "audio" | "text" | "unknown";

/** Canonical extension → MIME mapping used for fallbacks and output naming. */
export const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docm: "application/vnd.ms-word.document.macroEnabled.12",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  zip: "application/zip",
  gz: "application/gzip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
};

/** Preferred extension for a MIME type (used when an optimizer changes format). */
export const MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-word.document.macroEnabled.12": "docm",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm",
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12": "pptm",
  "application/x-cfb": "bin",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/x-7z-compressed": "7z",
  "application/vnd.rar": "rar",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
};

const MIME_ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/mp3": "audio/mpeg",
  "application/x-zip-compressed": "application/zip",
  "application/x-zip": "application/zip",
  "application/x-pdf": "application/pdf",
  "video/x-quicktime": "video/quicktime",
};

export const OOXML_TYPES: readonly string[] = [
  EXTENSION_TO_MIME.docx!,
  EXTENSION_TO_MIME.xlsx!,
  EXTENSION_TO_MIME.pptx!,
  EXTENSION_TO_MIME.docm!,
  EXTENSION_TO_MIME.xlsm!,
  EXTENSION_TO_MIME.pptm!,
];

/** Lower-cases, strips parameters (`; charset=...`) and resolves common aliases. */
export function normalizeMime(mime: string): string {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_ALIASES[base] ?? base;
}

/** Lower-case extension without dot, or "" when the name has none. */
export function getExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function mimeFromExtension(name: string): string | undefined {
  return EXTENSION_TO_MIME[getExtension(name)];
}

export function extensionForMime(mime: string): string | undefined {
  return MIME_TO_EXTENSION[normalizeMime(mime)];
}

export function categoryForMime(mime: string): FileCategory {
  const m = normalizeMime(mime);
  if (!m || m === "application/octet-stream") return "unknown";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (
    OOXML_TYPES.includes(m) ||
    m === "application/msword" ||
    m === "application/vnd.ms-excel" ||
    m === "application/vnd.ms-powerpoint" ||
    m === "application/x-cfb"
  ) {
    return "document";
  }
  if (
    m === "application/zip" ||
    m === "application/gzip" ||
    m === "application/x-7z-compressed" ||
    m === "application/vnd.rar"
  ) {
    return "archive";
  }
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml") return "text";
  return "unknown";
}

/**
 * Tests a MIME type / file name against `accept`-style patterns:
 * `"image/*"`, `"application/pdf"`, `".pdf"`, `"*"`.
 */
export function matchesAcceptPattern(mime: string, name: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  if (p === "*" || p === "*/*") return true;
  const m = normalizeMime(mime);
  if (p.startsWith(".")) {
    const wanted = p.slice(1);
    const fromMime = EXTENSION_TO_MIME[wanted];
    if (fromMime && fromMime === m) return true;
    return getExtension(name) === wanted;
  }
  if (p.endsWith("/*")) return m.startsWith(p.slice(0, -1));
  return normalizeMime(p) === m;
}

export function matchesAccept(mime: string, name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesAcceptPattern(mime, name, pattern));
}

/** Replaces (or appends) the extension of a file name. */
export function replaceExtension(name: string, extension: string): string {
  const ext = getExtension(name);
  const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
  return `${stem}.${extension}`;
}
