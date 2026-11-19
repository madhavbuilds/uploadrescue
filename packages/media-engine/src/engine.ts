import {
  OptimizationError,
  throwIfAborted,
  type EngineOutput,
  type OptimizationEngine,
} from "@uploadrescue/core";
import { MEDIA_TYPES, parseDuration, planMediaJob, type MediaType } from "./plan";

/** The subset of `@ffmpeg/ffmpeg`'s `FFmpeg` class the engine uses. */
export interface FFmpegLike {
  load(config?: { coreURL?: string; wasmURL?: string; workerURL?: string }): Promise<unknown>;
  exec(args: string[]): Promise<number>;
  writeFile(path: string, data: Uint8Array): Promise<unknown>;
  readFile(path: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<unknown>;
  on(event: "progress", cb: (e: { progress: number }) => void): void;
  on(event: "log", cb: (e: { message: string }) => void): void;
  off?(event: "progress" | "log", cb: (...args: never[]) => void): void;
  terminate(): void;
}

export interface MediaEngineOptions {
  /**
   * URLs of `@ffmpeg/core` assets that you host yourself (copy them from
   * `node_modules/@ffmpeg/core/dist/esm`). Required unless `loadFFmpeg` is given.
   * UploadRescue never fetches FFmpeg from a third-party CDN on its own.
   */
  coreURL?: string;
  wasmURL?: string;
  /** Custom loader returning a ready (loaded) FFmpeg instance. */
  loadFFmpeg?: () => Promise<FFmpegLike>;
  /**
   * Fetch the core files and pass Blob URLs to FFmpeg (default true). This
   * avoids bundler dev servers rewriting the worker's dynamic import. Requires
   * `blob:` in your CSP `script-src`/`worker-src`; set false to pass the URLs as-is.
   */
  useBlobURLs?: boolean;
  /** Largest input processed in the browser. Default 200 MiB. */
  maxInputSize?: number;
}

export interface MediaSupport {
  supported: boolean;
  reason?: string;
}

/** Explains whether media optimization can run in this environment. */
export function getMediaSupport(options: MediaEngineOptions, fileSize?: number): MediaSupport {
  if (!options.loadFFmpeg && !(options.coreURL && options.wasmURL)) {
    return {
      supported: false,
      reason: "Media optimization is not configured (FFmpeg core URLs are missing).",
    };
  }
  if (typeof WebAssembly === "undefined")
    return { supported: false, reason: "This browser does not support WebAssembly." };
  // The bundled loader runs FFmpeg in a worker; custom loaders decide for themselves.
  if (!options.loadFFmpeg && typeof Worker === "undefined") {
    return { supported: false, reason: "This environment does not support Web Workers." };
  }
  const max = options.maxInputSize ?? 200 * 1024 * 1024;
  if (fileSize !== undefined && fileSize > max) {
    return { supported: false, reason: "This file is too large to process in the browser." };
  }
  const memory = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory;
  if (
    fileSize !== undefined &&
    memory !== undefined &&
    memory < 4 &&
    fileSize > 100 * 1024 * 1024
  ) {
    return {
      supported: false,
      reason: "This device does not have enough memory to process the file.",
    };
  }
  return { supported: true };
}

/** Fetches one of the developer's self-hosted FFmpeg files into a Blob URL. */
async function toBlobURL(url: string, type: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url} (HTTP ${response.status}).`);
  return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type }));
}

async function defaultLoader(options: MediaEngineOptions): Promise<FFmpegLike> {
  let mod: { FFmpeg: new () => FFmpegLike };
  try {
    mod = (await import("@ffmpeg/ffmpeg")) as unknown as { FFmpeg: new () => FFmpegLike };
  } catch (error) {
    throw new OptimizationError(
      "environment",
      "Install @ffmpeg/ffmpeg to enable media optimization.",
      {
        cause: error,
        engine: "media",
      },
    );
  }
  const ffmpeg = new mod.FFmpeg();
  if (options.useBlobURLs === false) {
    await ffmpeg.load({ coreURL: options.coreURL!, wasmURL: options.wasmURL! });
    return ffmpeg;
  }
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(options.coreURL!, "text/javascript"),
    toBlobURL(options.wasmURL!, "application/wasm"),
  ]);
  try {
    await ffmpeg.load({ coreURL, wasmURL });
  } finally {
    URL.revokeObjectURL(coreURL);
    URL.revokeObjectURL(wasmURL);
  }
  return ffmpeg;
}

/**
 * MP4 / MOV / MP3 / WAV optimizer using FFmpeg compiled to WebAssembly.
 *
 * FFmpeg (~30 MB) is loaded lazily on the first matching file and kept for
 * later files. Cancelling terminates the FFmpeg worker immediately.
 * Video is re-encoded to H.264/AAC (in-browser encoding is slow: expect
 * roughly real-time or slower for HD video).
 */
export function createMediaEngine(options: MediaEngineOptions = {}): OptimizationEngine {
  let instance: Promise<FFmpegLike> | null = null;
  const get = () => {
    instance ??= (options.loadFFmpeg ? options.loadFFmpeg() : defaultLoader(options)).catch(
      (error: unknown) => {
        instance = null;
        throw error instanceof OptimizationError
          ? error
          : new OptimizationError("environment", "FFmpeg could not be loaded.", {
              cause: error,
              engine: "media",
            });
      },
    );
    return instance;
  };
  const discard = (ffmpeg: FFmpegLike) => {
    try {
      ffmpeg.terminate();
    } catch {
      // Already terminated.
    }
    instance = null;
  };

  return {
    id: "media",
    supportedTypes: MEDIA_TYPES,
    canProcess: (file) => getMediaSupport(options, file.size).supported,
    async optimize(file, opts, ctx): Promise<EngineOutput> {
      const support = getMediaSupport(options, file.size);
      if (!support.supported) {
        throw new OptimizationError(
          "environment",
          support.reason ?? "Media optimization is unavailable.",
          { engine: "media" },
        );
      }
      ctx.onProgress(null, "Loading FFmpeg");
      const ffmpeg = await get();
      throwIfAborted(ctx.signal);

      const onAbort = () => discard(ffmpeg);
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      let log = "";
      const onLog = (e: { message: string }) => {
        if (log.length < 64 * 1024) log += `${e.message}\n`;
      };
      const onProgress = (e: { progress: number }) => {
        if (Number.isFinite(e.progress))
          ctx.onProgress(Math.min(0.99, Math.max(0, e.progress)), "Encoding");
      };
      ffmpeg.on("log", onLog);
      const mime = ctx.info.detected.mime as MediaType;
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        // Probe duration: `ffmpeg -i` without output exits non-zero but logs metadata.
        const plan0 = planMediaJob({
          mime,
          quality: opts.quality,
          preserveFormat: opts.preserveFormat,
          attempt: opts.attempt,
        });
        await ffmpeg.writeFile(plan0.inputName, data);
        await ffmpeg.exec(["-hide_banner", "-i", plan0.inputName]);
        const durationSec = parseDuration(log);
        throwIfAborted(ctx.signal);

        const plan = planMediaJob({
          mime,
          quality: opts.quality,
          preserveFormat: opts.preserveFormat,
          attempt: opts.attempt,
          ...(durationSec !== undefined ? { durationSec } : {}),
          ...(opts.targetSize !== undefined ? { targetSize: opts.targetSize } : {}),
          ...(opts.maxDimension !== undefined ? { maxDimension: opts.maxDimension } : {}),
          ...(opts.allowedOutputTypes ? { allowedOutputTypes: opts.allowedOutputTypes } : {}),
        });
        ffmpeg.on("progress", onProgress);
        const code = await ffmpeg.exec(["-hide_banner", "-y", ...plan.args]);
        throwIfAborted(ctx.signal);
        if (code !== 0) {
          throw new OptimizationError("failed", "FFmpeg could not process this file.", {
            engine: "media",
            cause: log.slice(-2000),
          });
        }
        const output = await ffmpeg.readFile(plan.outputName);
        if (typeof output === "string" || output.length === 0) {
          throw new OptimizationError("invalid-output", "FFmpeg produced no output.", {
            engine: "media",
          });
        }
        await Promise.allSettled([
          ffmpeg.deleteFile(plan.inputName),
          ffmpeg.deleteFile(plan.outputName),
        ]);
        ctx.onProgress(1, "Done");
        return {
          blob: new Blob([output as BlobPart], { type: plan.outputType }),
          type: plan.outputType,
          notes: [`Re-encoded as ${plan.description}.`],
          details: { durationSec, args: plan.args.join(" ") },
        };
      } catch (error) {
        // A failed or aborted run can leave FFmpeg in an unknown state.
        discard(ffmpeg);
        if (ctx.signal.aborted)
          throw new OptimizationError("aborted", "Optimization was cancelled.", {
            engine: "media",
          });
        throw error;
      } finally {
        ctx.signal.removeEventListener("abort", onAbort);
        ffmpeg.off?.("log", onLog as never);
        ffmpeg.off?.("progress", onProgress as never);
      }
    },
  };
}
