import {
  OptimizationError,
  throwIfAborted,
  type EngineOutput,
  type OptimizationEngine,
} from "@uploadrescue/core";
import type * as PdfLibModule from "pdf-lib";
import type { PDFDict, PDFDocument, PDFObject, PDFRawStream, PDFRef } from "pdf-lib";

type PdfLib = typeof PdfLibModule;

export interface PdfInspection {
  version: string | null;
  pageCount: number;
  encrypted: boolean;
  signed: boolean;
  hasForms: boolean;
  /** Number of `%%EOF` markers − 1. */
  incrementalUpdates: number;
  images: number;
  /** JPEG (DCTDecode) images eligible for re-encoding. */
  recompressibleImages: number;
  linearized: boolean;
}

/** Re-encodes a baseline JPEG; returns null to keep the original. */
export type JpegRecompressor = (
  jpeg: Uint8Array,
  options: { quality: number; maxDimension?: number; signal: AbortSignal },
) => Promise<{ data: Uint8Array; width: number; height: number; components: number } | null>;

export interface PdfEngineOptions {
  /** Re-encode embedded JPEG images. Default true (needs a browser canvas unless `recompress` is given). */
  recompressImages?: boolean;
  /** Maximum embedded image width/height in pixels. Default 2000. */
  maxImageDimension?: number;
  /** Only re-encode images larger than this many bytes. Default 20 KB. */
  minImageBytes?: number;
  /** Allow modifying signed PDFs (this invalidates signatures). Default false. */
  allowSignatureInvalidation?: boolean;
  /** Largest PDF loaded into memory. Default 200 MiB. */
  maxInputSize?: number;
  /** Override JPEG re-encoding (defaults to the image engine). */
  recompress?: JpegRecompressor;
}

let pdfLib: Promise<PdfLib> | null = null;
/** pdf-lib is loaded on first use only. */
function loadPdfLib(): Promise<PdfLib> {
  pdfLib ??= import("pdf-lib");
  return pdfLib;
}

/** Reads the SOF segment of a JPEG: width, height and component count. */
export function readJpegFrame(
  b: Uint8Array,
): { width: number; height: number; components: number } | null {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    const len = (b[o + 2]! << 8) | b[o + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (b[o + 5]! << 8) | b[o + 6]!,
        width: (b[o + 7]! << 8) | b[o + 8]!,
        components: b[o + 9]!,
      };
    }
    o += 2 + len;
  }
  return null;
}

const defaultRecompress: JpegRecompressor = async (jpeg, options) => {
  const { recompressImage } = await import("@uploadrescue/image-engine");
  const blob = await recompressImage(
    new Blob([jpeg as BlobPart], { type: "image/jpeg" }),
    "image/jpeg",
    options,
  );
  if (!blob) return null;
  const data = new Uint8Array(await blob.arrayBuffer());
  const frame = readJpegFrame(data);
  return frame ? { data, ...frame } : null;
};

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < Math.min(end, bytes.length); i += 1) s += String.fromCharCode(bytes[i]!);
  return s;
}

function countEof(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i + 5 <= bytes.length; i += 1) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x25 &&
      bytes[i + 2] === 0x45 &&
      bytes[i + 3] === 0x4f &&
      bytes[i + 4] === 0x46
    ) {
      count += 1;
    }
  }
  return count;
}

async function loadDocument(lib: PdfLib, bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const doc = await lib.PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    // pdf-lib tolerates some garbage at load time; make sure the page tree is usable.
    if (!doc.isEncrypted && doc.getPageCount() < 1) throw new Error("The PDF has no pages.");
    return doc;
  } catch (error) {
    throw new OptimizationError(
      "failed",
      "The PDF is malformed or uses features that cannot be parsed safely.",
      {
        cause: error,
        engine: "pdf",
      },
    );
  }
}

interface ImageCandidate {
  ref: PDFRef;
  stream: PDFRawStream;
}

function analyse(lib: PdfLib, doc: PDFDocument, minImageBytes: number) {
  const { PDFName, PDFRawStream, PDFDict, PDFArray, PDFNumber, PDFBool } = lib;
  const n = (s: string) => PDFName.of(s);
  let images = 0;
  let signed = false;
  const jpegs: ImageCandidate[] = [];
  const isSigDict = (dict: PDFDict) =>
    dict.get(n("Type")) === n("Sig") || dict.get(n("FT")) === n("Sig") || dict.has(n("ByteRange"));

  for (const [ref, obj] of doc.context.enumerateIndirectObjects() as Array<[PDFRef, PDFObject]>) {
    if (obj instanceof PDFDict && isSigDict(obj)) signed = true;
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (isSigDict(dict)) signed = true;
    if (dict.get(n("Subtype")) !== n("Image")) continue;
    images += 1;
    let filter = dict.get(n("Filter"));
    if (filter instanceof PDFArray && filter.size() === 1) filter = filter.get(0);
    const cs = dict.get(n("ColorSpace"));
    const bpc = dict.get(n("BitsPerComponent"));
    const eligible =
      filter === n("DCTDecode") &&
      (cs === n("DeviceRGB") || cs === n("DeviceGray")) &&
      bpc instanceof PDFNumber &&
      bpc.asNumber() === 8 &&
      !dict.has(n("Decode")) &&
      !dict.has(n("DecodeParms")) &&
      dict.get(n("ImageMask")) !== PDFBool.True &&
      obj.contents.length >= minImageBytes;
    if (eligible) jpegs.push({ ref, stream: obj });
  }
  const acroForm = doc.catalog.get(n("AcroForm"));
  const sigFlags = acroForm instanceof PDFDict ? acroForm.get(n("SigFlags")) : undefined;
  if (sigFlags instanceof PDFNumber && (sigFlags.asNumber() & 1) === 1) signed = true;
  return { images, jpegs, signed, hasForms: acroForm !== undefined };
}

/** Inspects a PDF without modifying it. Throws `OptimizationError` for unparseable files. */
export async function inspectPdf(file: Blob): Promise<PdfInspection> {
  const lib = await loadPdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = latin1(bytes, 0, 1024);
  if (!header.startsWith("%PDF-")) {
    throw new OptimizationError("failed", "The file does not start with a PDF header.", {
      engine: "pdf",
    });
  }
  const doc = await loadDocument(lib, bytes);
  const a = analyse(lib, doc, 0);
  return {
    version: /^%PDF-(\d\.\d)/.exec(header)?.[1] ?? null,
    pageCount: doc.getPageCount(),
    encrypted: doc.isEncrypted,
    signed: a.signed,
    hasForms: a.hasForms,
    incrementalUpdates: Math.max(0, countEof(bytes) - 1),
    images: a.images,
    recompressibleImages: a.jpegs.length,
    linearized: header.includes("/Linearized"),
  };
}

/**
 * PDF optimizer.
 *
 * 1. Refuses encrypted PDFs, and signed PDFs unless explicitly allowed.
 * 2. Re-encodes eligible JPEG images (DeviceRGB/Gray, 8-bit, no decode
 *    arrays) when that makes them ≥10% smaller.
 * 3. Rewrites the file with object streams, which also collapses incremental
 *    updates. Text, fonts, vector content, forms and metadata are preserved.
 * 4. Verifies the output parses and has the same page count.
 *
 * Compression is not guaranteed: text-only or already-optimized PDFs often
 * cannot be made smaller.
 */
export function createPdfEngine(options: PdfEngineOptions = {}): OptimizationEngine {
  const maxInputSize = options.maxInputSize ?? 200 * 1024 * 1024;
  const recompress = options.recompress ?? defaultRecompress;
  return {
    id: "pdf",
    supportedTypes: ["application/pdf"],
    canProcess: (file) => file.size <= maxInputSize,
    async optimize(file, opts, ctx): Promise<EngineOutput> {
      const lib = await loadPdfLib();
      const { PDFName, PDFNumber, PDFRawStream } = lib;
      const bytes = new Uint8Array(await file.arrayBuffer());
      ctx.onProgress(0.05, "Reading PDF");
      const doc = await loadDocument(lib, bytes);
      throwIfAborted(ctx.signal);
      if (doc.isEncrypted) {
        throw new OptimizationError("unsupported", "Encrypted PDFs are not modified.", {
          engine: "pdf",
        });
      }
      const pageCount = doc.getPageCount();
      const a = analyse(lib, doc, options.minImageBytes ?? 20 * 1024);
      if (a.signed && !options.allowSignatureInvalidation) {
        throw new OptimizationError(
          "unsupported",
          "This PDF is digitally signed; optimizing it would invalidate the signature.",
          { engine: "pdf" },
        );
      }

      const notes: string[] = [];
      let replaced = 0;
      let imageBytesSaved = 0;
      const canvasAvailable = typeof createImageBitmap === "function";
      const shouldRecompress =
        (options.recompressImages ?? true) && (options.recompress !== undefined || canvasAvailable);
      if (shouldRecompress && a.jpegs.length > 0) {
        const quality = Math.min(opts.quality, 0.8) - opts.attempt * 0.1;
        for (const [i, { ref, stream }] of a.jpegs.entries()) {
          throwIfAborted(ctx.signal);
          ctx.onProgress(
            0.1 + (0.75 * i) / a.jpegs.length,
            `Optimizing image ${i + 1} of ${a.jpegs.length}`,
          );
          let out;
          try {
            out = await recompress(stream.contents, {
              quality: Math.max(0.4, quality),
              maxDimension: opts.maxDimension ?? options.maxImageDimension ?? 2000,
              signal: ctx.signal,
            });
          } catch (error) {
            if (ctx.signal.aborted) throw error;
            out = null; // Undecodable image: keep the original.
          }
          if (!out || out.components === 4 || out.data.length >= stream.contents.length * 0.9)
            continue;
          const dict = stream.dict.clone(doc.context);
          dict.set(PDFName.of("Width"), PDFNumber.of(out.width));
          dict.set(PDFName.of("Height"), PDFNumber.of(out.height));
          dict.set(
            PDFName.of("ColorSpace"),
            PDFName.of(out.components === 1 ? "DeviceGray" : "DeviceRGB"),
          );
          doc.context.assign(ref, PDFRawStream.of(dict, out.data));
          imageBytesSaved += stream.contents.length - out.data.length;
          replaced += 1;
        }
        notes.push(
          `Re-encoded ${replaced} of ${a.jpegs.length} eligible JPEG images (saved ${Math.round(imageBytesSaved / 1024)} KB).`,
        );
      } else if (a.images > 0 && !shouldRecompress) {
        notes.push("Embedded images were left unchanged (image re-encoding unavailable).");
      }

      ctx.onProgress(0.9, "Rewriting PDF");
      const saved = await doc.save({
        useObjectStreams: true,
        updateFieldAppearances: false,
        addDefaultPage: false,
      });
      throwIfAborted(ctx.signal);

      // Validate the output before reporting success.
      const check = await loadDocument(lib, saved);
      if (check.getPageCount() !== pageCount) {
        throw new OptimizationError(
          "invalid-output",
          "The optimized PDF has a different page count.",
          { engine: "pdf" },
        );
      }
      notes.push(
        "Rewrote the file structure with object streams; text, fonts and pages were preserved.",
      );
      if (a.hasForms) notes.push("Form fields were preserved.");
      ctx.onProgress(1, "Done");
      return {
        blob: new Blob([saved as BlobPart], { type: "application/pdf" }),
        type: "application/pdf",
        notes,
        details: { pageCount, images: a.images, imagesReencoded: replaced, imageBytesSaved },
      };
    },
  };
}
