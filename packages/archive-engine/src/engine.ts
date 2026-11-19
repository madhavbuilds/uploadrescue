import { OptimizationError, type EngineOutput, type OptimizationEngine } from "@uploadrescue/core";
import {
  ArchiveError,
  DEFAULT_ZIP_LIMITS,
  readZipDirectory,
  repackZip,
  type ZipLimits,
} from "./zip";

export interface ArchiveEngineOptions {
  limits?: Partial<ZipLimits>;
  /** Deflate level. Default 9. */
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Largest archive the engine will load into memory. Default 256 MiB. */
  maxInputSize?: number;
}

export interface ArchiveInspection {
  entries: number;
  files: number;
  directories: number;
  compressedSize: number;
  uncompressedSize: number;
  encryptedEntries: number;
  /** Count of entries per compression method (0 = stored, 8 = deflate). */
  methods: Record<number, number>;
}

/** Safely summarises a ZIP archive without extracting it. Throws `ArchiveError` on unsafe input. */
export async function inspectZip(
  file: Blob,
  limits: Partial<ZipLimits> = {},
): Promise<ArchiveInspection> {
  const entries = readZipDirectory(new Uint8Array(await file.arrayBuffer()), {
    ...DEFAULT_ZIP_LIMITS,
    ...limits,
  });
  const methods: Record<number, number> = {};
  let compressedSize = 0;
  let uncompressedSize = 0;
  for (const e of entries) {
    methods[e.method] = (methods[e.method] ?? 0) + 1;
    compressedSize += e.compressedSize;
    uncompressedSize += e.uncompressedSize;
  }
  return {
    entries: entries.length,
    files: entries.filter((e) => !e.isDirectory).length,
    directories: entries.filter((e) => e.isDirectory).length,
    compressedSize,
    uncompressedSize,
    encryptedEntries: entries.filter((e) => e.encrypted).length,
    methods,
  };
}

export function archiveErrorToOptimizationError(error: unknown, engine: string): OptimizationError {
  if (error instanceof OptimizationError) return error;
  if (error instanceof ArchiveError) {
    const reason =
      error.code === "too-large" ||
      error.code === "too-many-entries" ||
      error.code === "ratio-exceeded"
        ? "resource-limit"
        : error.code === "encrypted" ||
            error.code === "zip64-unsupported" ||
            error.code === "unsupported-method"
          ? "unsupported"
          : "failed";
    return new OptimizationError(reason, error.message, { cause: error, engine });
  }
  if ((error as { name?: string })?.name === "AbortError") {
    return new OptimizationError("aborted", "Optimization was cancelled.", {
      cause: error,
      engine,
    });
  }
  return new OptimizationError("failed", "The archive could not be processed.", {
    cause: error,
    engine,
  });
}

/**
 * Conservative ZIP optimizer: recompresses entries with maximum deflate and
 * keeps whichever encoding is smaller. Contents are never modified. Unsafe
 * archives (bombs, traversal paths, encryption, ZIP64) are refused.
 */
export function createArchiveEngine(options: ArchiveEngineOptions = {}): OptimizationEngine {
  const limits: ZipLimits = { ...DEFAULT_ZIP_LIMITS, ...options.limits };
  const maxInputSize = options.maxInputSize ?? 256 * 1024 * 1024;
  return {
    id: "archive",
    supportedTypes: ["application/zip"],
    canProcess: (file) => file.size <= maxInputSize,
    async optimize(file, _opts, ctx): Promise<EngineOutput> {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { bytes: out, stats } = await repackZip(bytes, {
          limits,
          level: options.level ?? 9,
          signal: ctx.signal,
          onProgress: (r) => ctx.onProgress(r, "Recompressing entries"),
        });
        return {
          blob: new Blob([out as BlobPart], { type: "application/zip" }),
          type: "application/zip",
          notes: [
            `Recompressed ${stats.recompressed} of ${stats.entries} entries; file contents were not modified.`,
            "Extra fields (such as extended timestamps) were dropped; names, dates and attributes were kept.",
          ],
          details: { ...stats },
        };
      } catch (error) {
        throw archiveErrorToOptimizationError(error, "archive");
      }
    },
  };
}
