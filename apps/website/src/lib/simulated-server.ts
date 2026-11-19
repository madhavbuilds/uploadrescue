import { UploadHttpError, delay, type UploadFunction } from "@uploadrescue/core";

export interface SimulatedServerOptions {
  /** Reject files larger than this with HTTP 413. null = accept everything. */
  limit: number | null;
  /** Send `X-Upload-Max-Size` with the 413 so the optimizer knows the exact limit. */
  announceLimit?: boolean;
  /** Simulated bandwidth in bytes per second. */
  bytesPerSecond?: number;
}

export interface SimulatedUploadResult {
  simulated: true;
  receivedBytes: number;
  name: string;
}

/**
 * A fake server that runs entirely in the page. Nothing is transmitted:
 * it waits proportionally to the file size, reports progress, then either
 * "accepts" the file or throws the same UploadHttpError a real 413 would.
 */
export function createSimulatedServer(
  options: SimulatedServerOptions,
): UploadFunction<SimulatedUploadResult> {
  return async (file, context) => {
    const speed = options.bytesPerSecond ?? 6 * 1024 * 1024;
    const duration = Math.min(2500, Math.max(400, (file.size / speed) * 1000));
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      await delay(duration / steps, context.signal);
      context.reportProgress(Math.round((file.size * i) / steps), file.size);
    }
    if (options.limit !== null && file.size > options.limit) {
      throw new UploadHttpError({
        status: 413,
        statusText: "Payload Too Large",
        body: JSON.stringify({ error: "Payload Too Large (simulated)" }),
        headers: options.announceLimit ? { "x-upload-max-size": String(options.limit) } : {},
      });
    }
    return { simulated: true, receivedBytes: file.size, name: file.name };
  };
}
