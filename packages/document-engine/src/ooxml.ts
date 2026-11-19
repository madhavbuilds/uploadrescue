import {
  DEFAULT_ZIP_LIMITS,
  readZipDirectory,
  type ZipEntry,
  type ZipLimits,
} from "@uploadrescue/archive-engine";

export type OoxmlKind = "word" | "spreadsheet" | "presentation";

export interface OoxmlInspection {
  kind: OoxmlKind;
  entries: number;
  /** Embedded media parts (images, video, audio) in the package. */
  media: Array<{ name: string; size: number }>;
  mediaBytes: number;
  /** VBA project present (macro-enabled document). Macros are always preserved. */
  hasMacros: boolean;
  /** Embedded OLE objects / other packages. */
  embeddings: number;
  /** Package includes a digital signature part. */
  signed: boolean;
}

const MAIN_PARTS: Record<OoxmlKind, string> = {
  word: "word/document.xml",
  spreadsheet: "xl/workbook.xml",
  presentation: "ppt/presentation.xml",
};

export const MEDIA_PATTERN = /^(word|xl|ppt)\/media\/[^/]+$/i;

export class OoxmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OoxmlError";
  }
}

/** Validates the package structure and summarises it. */
export function inspectOoxml(
  bytes: Uint8Array,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): { info: OoxmlInspection; entries: ZipEntry[] } {
  const entries = readZipDirectory(bytes, limits);
  const names = new Set(entries.map((e) => e.name));
  if (!names.has("[Content_Types].xml"))
    throw new OoxmlError("Missing [Content_Types].xml: not an Office Open XML package.");
  if (!names.has("_rels/.rels"))
    throw new OoxmlError("Missing _rels/.rels: the package is incomplete.");
  const kind = (Object.keys(MAIN_PARTS) as OoxmlKind[]).find((k) => names.has(MAIN_PARTS[k]));
  if (!kind)
    throw new OoxmlError(
      "No main document part found (word/document.xml, xl/workbook.xml or ppt/presentation.xml).",
    );
  const media = entries
    .filter((e) => MEDIA_PATTERN.test(e.name))
    .map((e) => ({ name: e.name, size: e.uncompressedSize }));
  return {
    entries,
    info: {
      kind,
      entries: entries.length,
      media,
      mediaBytes: media.reduce((sum, m) => sum + m.size, 0),
      hasMacros: entries.some((e) => /vbaProject\.bin$/i.test(e.name)),
      embeddings: entries.filter((e) => /\/embeddings\//i.test(e.name)).length,
      signed: entries.some((e) => e.name.startsWith("_xmlsignatures/")),
    },
  };
}
