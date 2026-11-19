import {
  DEFAULT_ZIP_LIMITS,
  archiveErrorToOptimizationError,
  repackZip,
  type ZipLimits,
} from "@uploadrescue/archive-engine";
import {
  OOXML_TYPES,
  OptimizationError,
  normalizeMime,
  type EngineOutput,
  type OptimizationEngine,
} from "@uploadrescue/core";
import { recompressImage } from "@uploadrescue/image-engine";
import { MEDIA_PATTERN, OoxmlError, inspectOoxml } from "./ooxml";

export type MediaRecompressor = (
  data: Uint8Array,
  type: "image/jpeg" | "image/png",
  options: { quality: number; maxDimension?: number; signal: AbortSignal },
) => Promise<Uint8Array | null>;

export interface DocumentEngineOptions {
  limits?: Partial<ZipLimits>;
  /** Re-encode embedded JPEG/PNG images in the same format. Default true. */
  recompressMedia?: boolean;
  /** Maximum embedded image width/height. Default 2400 px. */
  maxImageDimension?: number;
  /** Largest package loaded into memory. Default 256 MiB. */
  maxInputSize?: number;
  /** Override media recompression (defaults to the image engine). */
  recompress?: MediaRecompressor;
  /** Allow optimizing digitally signed packages (invalidates the signature). Default false. */
  allowSignatureInvalidation?: boolean;
}

const defaultRecompress: MediaRecompressor = async (data, type, options) => {
  const blob = await recompressImage(new Blob([data as BlobPart], { type }), type, options);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
};

function mediaType(name: string): "image/jpeg" | "image/png" | null {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  return null;
}

/**
 * DOCX / XLSX / PPTX optimizer (and macro-enabled variants).
 *
 * Only two things change: embedded JPEG/PNG media may be re-encoded in the
 * same format under the same name (so relationships stay valid), and the
 * package is re-deflated. XML parts, relationships, styles, formulas, macros
 * and embedded objects are carried over byte-for-byte; the output is
 * CRC-verified against the expected content.
 */
export function createDocumentEngine(options: DocumentEngineOptions = {}): OptimizationEngine {
  const limits: ZipLimits = { ...DEFAULT_ZIP_LIMITS, ...options.limits };
  const maxInputSize = options.maxInputSize ?? 256 * 1024 * 1024;
  const recompress = options.recompress ?? defaultRecompress;
  return {
    id: "document",
    supportedTypes: OOXML_TYPES,
    canProcess: (file) => file.size <= maxInputSize,
    async optimize(file, opts, ctx): Promise<EngineOutput> {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { info } = inspectOoxml(bytes, limits);
        if (info.signed && !options.allowSignatureInvalidation) {
          throw new OptimizationError(
            "unsupported",
            "This document is digitally signed; optimizing it would invalidate the signature.",
            { engine: "document" },
          );
        }
        let mediaDone = 0;
        let mediaSaved = 0;
        const doMedia = (options.recompressMedia ?? true) && info.media.length > 0;
        const { bytes: out, stats } = await repackZip(bytes, {
          limits,
          signal: ctx.signal,
          onProgress: (r) =>
            ctx.onProgress(r, doMedia ? "Optimizing embedded media" : "Recompressing package"),
          transform: doMedia
            ? async (entry, data) => {
                const type = MEDIA_PATTERN.test(entry.name) ? mediaType(entry.name) : null;
                if (!type) return null;
                const result = await recompress(data, type, {
                  quality: Math.min(opts.quality, 0.8),
                  maxDimension: opts.maxDimension ?? options.maxImageDimension ?? 2400,
                  signal: ctx.signal,
                });
                if (result && result.length < data.length) {
                  mediaDone += 1;
                  mediaSaved += data.length - result.length;
                  return result;
                }
                return null;
              }
            : undefined,
        });
        const notes = [
          `Re-deflated ${stats.recompressed} of ${stats.entries} package parts.`,
          doMedia
            ? `Re-encoded ${mediaDone} of ${info.media.length} embedded images (saved ${Math.round(mediaSaved / 1024)} KB).`
            : "No embedded images were changed.",
          "Text, styles, relationships, formulas and macros were preserved unchanged.",
        ];
        if (info.hasMacros)
          notes.push("The document contains macros; they were preserved unchanged.");
        return {
          blob: new Blob([out as BlobPart]),
          // Keep the declared Office type (never rename a .docx to .docm based on sniffing).
          type: OOXML_TYPES.includes(normalizeMime(file.type))
            ? normalizeMime(file.type)
            : ctx.info.detected.mime,
          notes,
          details: {
            ...info,
            media: info.media.length,
            mediaRecompressed: mediaDone,
            mediaSaved,
            ...stats,
          },
        };
      } catch (error) {
        if (error instanceof OoxmlError) {
          throw new OptimizationError("failed", error.message, {
            cause: error,
            engine: "document",
          });
        }
        throw archiveErrorToOptimizationError(error, "document");
      }
    },
  };
}
