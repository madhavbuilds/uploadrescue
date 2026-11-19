import { describe, expect, it, vi } from "vitest";
import {
  TRANSITIONS,
  UploadHttpError,
  canTransition,
  createUploadRescue,
  lazyEngine,
  optimizeFile,
  type RecoveryState,
  type RecoveryStatus,
  type UploadContext,
} from "../src";
import { deferred, fakeEngine, makeFile } from "./helpers";

const KB = 1024;

/** Upload function that rejects files larger than `limit` with HTTP 413. */
function serverWithLimit(limit: number) {
  const calls: Array<{ file: File; context: UploadContext }> = [];
  const upload = vi.fn(async (file: File, context: UploadContext) => {
    calls.push({ file, context });
    if (file.size > limit)
      throw new UploadHttpError({ status: 413, statusText: "Payload Too Large" });
    return { id: `upload-${calls.length}`, size: file.size };
  });
  return { upload, calls };
}

function trackStatuses<T>(controller: {
  subscribe(fn: (s: RecoveryState<T>) => void): () => void;
}) {
  const statuses: RecoveryStatus[] = [];
  controller.subscribe((s) => {
    if (statuses[statuses.length - 1] !== s.status) statuses.push(s.status);
  });
  return statuses;
}

describe("transition table", () => {
  it("never allows leaving a terminal state except to restart", () => {
    for (const terminal of ["success", "failed", "cancelled"] as const) {
      expect(TRANSITIONS[terminal]).toEqual(["idle", "file-selected"]);
    }
    expect(canTransition("idle", "uploading")).toBe(false);
    expect(canTransition("optimizing", "success")).toBe(false);
  });
});

describe("UploadRescueController", () => {
  it("uploads directly when the file is fine", async () => {
    const server = serverWithLimit(10 * KB);
    const rescue = createUploadRescue({ upload: server.upload });
    const statuses = trackStatuses(rescue);
    const state = await rescue.select(makeFile(2 * KB, "a.png", "image/png"));
    expect(state.status).toBe("success");
    expect(state.result).toEqual({ id: "upload-1", size: 2 * KB });
    expect(statuses).toEqual(["file-selected", "validating", "uploading", "success"]);
  });

  it("recovers from HTTP 413 by optimizing and calling the same upload function again", async () => {
    const server = serverWithLimit(3 * KB);
    const onOptimization = vi.fn();
    const onSuccess = vi.fn();
    const rescue = createUploadRescue({
      upload: server.upload,
      engines: [fakeEngine({ factor: 0.4 })],
      onOptimization,
      onSuccess,
    });
    const statuses = trackStatuses(rescue);
    const original = makeFile(5 * KB, "photo.png", "image/png");
    const originalBytes = new Uint8Array(await original.arrayBuffer());

    let state = await rescue.select(original);
    expect(state.status).toBe("recovery-available");
    expect(state.failure).toMatchObject({ kind: "file-too-large", status: 413 });
    expect(state.recoveryAction).toBe("optimize");

    state = await rescue.recover();
    expect(state.status).toBe("success");
    expect(statuses).toEqual([
      "file-selected",
      "validating",
      "uploading",
      "upload-failed",
      "recovery-available",
      "optimizing",
      "optimization-complete",
      "retrying",
      "success",
    ]);
    expect(server.upload).toHaveBeenCalledTimes(2);
    const retry = server.calls[1]!;
    expect(retry.file.size).toBeLessThan(original.size);
    expect(retry.context).toMatchObject({ attempt: 2, isRetry: true, originalFile: original });
    expect(retry.context.optimization?.changed).toBe(true);
    expect(retry.context.previousFailure?.kind).toBe("file-too-large");
    // Fresh context per attempt, stable idempotency key per session.
    expect(retry.context.attemptId).not.toBe(server.calls[0]!.context.attemptId);
    expect(retry.context.idempotencyKey).toBe(server.calls[0]!.context.idempotencyKey);
    expect(retry.context.signal).not.toBe(server.calls[0]!.context.signal);
    expect(onOptimization).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ optimized: true }),
    );
    // Original file is untouched.
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(originalBytes);
    expect(state.optimization?.originalSize).toBe(5 * KB);
    expect(state.history.map((h) => `${h.type}:${h.outcome}`)).toEqual([
      "upload:failure",
      "optimization:success",
      "upload:success",
    ]);
  });

  it("detects oversized files client-side before uploading", async () => {
    const server = serverWithLimit(Infinity);
    const rescue = createUploadRescue({
      upload: server.upload,
      maxSize: 2 * KB,
      engines: [fakeEngine({ factor: 0.3 })],
    });
    const state = await rescue.select(makeFile(5 * KB, "big.png", "image/png"));
    expect(state.status).toBe("recovery-available");
    expect(state.failure).toMatchObject({ kind: "file-too-large", source: "validation" });
    expect(server.upload).not.toHaveBeenCalled();
    const done = await rescue.recover();
    expect(done.status).toBe("success");
    expect(server.calls[0]!.file.size).toBeLessThanOrEqual(2 * KB);
  });

  it("refuses to retry when the optimized file still exceeds the limit", async () => {
    const server = serverWithLimit(Infinity);
    const rescue = createUploadRescue({
      upload: server.upload,
      maxSize: 2 * KB,
      engines: [fakeEngine({ outputSize: 3 * KB })],
      optimization: { maxAttempts: 1 },
    });
    await rescue.select(makeFile(8 * KB, "big.png", "image/png"));
    const state = await rescue.recover();
    expect(state.status).toBe("optimization-failed");
    expect(state.optimizationFailure?.reason).toBe("target-not-reached");
    expect(state.optimizationFailure?.message).toContain("Maximum allowed: 2 KB. Optimized: 3 KB.");
    expect(state.optimization?.outputSize).toBe(3 * KB);
    expect(state.recoveryAction).toBeNull();
    expect(server.upload).not.toHaveBeenCalled();
  });

  it("offers stronger compression while attempts remain", async () => {
    const engine = fakeEngine({ factor: 0.8 });
    const rescue = createUploadRescue({
      upload: serverWithLimit(Infinity).upload,
      maxSize: 3 * KB,
      engines: [engine],
      optimization: { maxAttempts: 2 },
    });
    await rescue.select(makeFile(5 * KB, "big.png", "image/png"));
    let state = await rescue.recover(); // 0.8 → 4 KB, too big
    expect(state.status).toBe("optimization-failed");
    expect(state.recoveryAction).toBe("optimize");
    state = await rescue.recover(); // attempt 1 → 0.4 → 2 KB
    expect(state.status).toBe("success");
    expect(engine.calls.map((c) => c.attempt)).toEqual([0, 1]);
  });

  it("reports a no-reduction outcome honestly", async () => {
    const rescue = createUploadRescue({
      upload: serverWithLimit(1 * KB).upload,
      engines: [fakeEngine({ factor: 2 })],
      optimization: { maxAttempts: 1 },
    });
    await rescue.select(makeFile(4 * KB, "a.png", "image/png"));
    const state = await rescue.recover();
    expect(state.status).toBe("optimization-failed");
    expect(state.optimizationFailure?.reason).toBe("no-reduction");
    expect(state.optimization?.changed).toBe(false);
  });

  it("fails clearly when no engine can optimize the file", async () => {
    const rescue = createUploadRescue({ upload: serverWithLimit(1 * KB).upload, engines: [] });
    const state = await rescue.select(
      makeFile(4 * KB, "a.bin", "application/octet-stream", [1, 2, 3]),
    );
    expect(state.status).toBe("failed");
    expect(state.failure?.kind).toBe("file-too-large");
    expect(state.error).toBeInstanceOf(UploadHttpError);
  });

  it("never retries authentication or server errors", async () => {
    for (const status of [401, 403, 500]) {
      const upload = vi.fn(async () => {
        throw new UploadHttpError({ status });
      });
      const rescue = createUploadRescue({
        upload,
        engines: [fakeEngine()],
        recovery: { autoRetry: true },
      });
      const state = await rescue.select(makeFile(2 * KB, "a.png", "image/png"));
      expect(state.status).toBe("failed");
      expect(upload).toHaveBeenCalledTimes(1);
    }
  });

  it("offers a plain retry for network failures and optimization as an alternative", async () => {
    let fail = true;
    const upload = vi.fn(async () => {
      if (fail) {
        fail = false;
        throw new TypeError("Failed to fetch");
      }
      return "ok";
    });
    const rescue = createUploadRescue({ upload, engines: [fakeEngine()] });
    let state = await rescue.select(makeFile(2 * KB, "a.png", "image/png"));
    expect(state.recoveryAction).toBe("retry");
    expect(state.alternativeAction).toBe("optimize");
    state = await rescue.recover();
    expect(state.status).toBe("success");
    expect(upload.mock.calls[1]![0]).toBe(upload.mock.calls[0]![0]);
  });

  it("auto-retries within the attempt limit and then stops", async () => {
    const upload = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const rescue = createUploadRescue({ upload, recovery: { autoRetry: true, maxAttempts: 2 } });
    const state = await rescue.select(makeFile(2 * KB, "a.png", "image/png"));
    expect(state.status).toBe("failed");
    expect(upload).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(state.attempts).toMatchObject({ uploads: 3, recoveries: 2 });
  });

  it("auto-optimizes and retries after a 413 when autoRetry is on", async () => {
    const server = serverWithLimit(3 * KB);
    const rescue = createUploadRescue({
      upload: server.upload,
      engines: [fakeEngine({ factor: 0.5 })],
      recovery: { autoRetry: true },
    });
    const state = await rescue.select(makeFile(5 * KB, "a.png", "image/png"));
    expect(state.status).toBe("success");
    expect(server.upload).toHaveBeenCalledTimes(2);
  });

  it("targets a smaller size when the server limit is unknown, and learns announced limits", async () => {
    const engine = fakeEngine({ factor: 0.9 });
    const upload = vi.fn(async (file: File) => {
      if (file.size > 2 * KB) {
        throw new UploadHttpError({
          status: 413,
          headers: { "x-upload-max-size": String(2 * KB) },
        });
      }
      return "ok";
    });
    const rescue = createUploadRescue({ upload, engines: [engine] });
    const state = await rescue.select(makeFile(10 * KB, "a.png", "image/png"));
    expect(state.maxSize).toBe(2 * KB);
    await rescue.recover();
    expect(engine.calls[0]!.targetSize).toBe(2 * KB);
  });

  it("uses 60% of the rejected size as the target when no limit is known", async () => {
    const engine = fakeEngine({ factor: 0.5 });
    const rescue = createUploadRescue({
      upload: serverWithLimit(3 * KB).upload,
      engines: [engine],
    });
    await rescue.select(makeFile(10 * KB, "a.png", "image/png"));
    await rescue.recover();
    expect(engine.calls[0]!.targetSize).toBe(Math.floor(10 * KB * 0.6));
  });

  it("cancels an in-flight upload and ignores its late result", async () => {
    const pending = deferred<string>();
    let signal: AbortSignal | undefined;
    const rescue = createUploadRescue({
      upload: (_file, ctx) => {
        signal = ctx.signal;
        return pending.promise;
      },
    });
    const run = rescue.select(makeFile(2 * KB, "a.png", "image/png"));
    await vi.waitFor(() => expect(rescue.getState().status).toBe("uploading"));
    rescue.cancel();
    expect(signal?.aborted).toBe(true);
    pending.resolve("late");
    const state = await run;
    expect(state.status).toBe("cancelled");
    expect(rescue.getState().result).toBeUndefined();
  });

  it("cancels an in-flight optimization", async () => {
    const rescue = createUploadRescue({
      upload: serverWithLimit(1 * KB).upload,
      engines: [fakeEngine({ delayMs: 5_000 })],
    });
    await rescue.select(makeFile(4 * KB, "a.png", "image/png"));
    const run = rescue.recover();
    await vi.waitFor(() => expect(rescue.getState().status).toBe("optimizing"));
    rescue.cancel();
    await run;
    expect(rescue.getState().status).toBe("cancelled");
  });

  it("deduplicates concurrent recover() calls", async () => {
    const server = serverWithLimit(3 * KB);
    const engine = fakeEngine({ factor: 0.5, delayMs: 20 });
    const rescue = createUploadRescue({ upload: server.upload, engines: [engine] });
    await rescue.select(makeFile(5 * KB, "a.png", "image/png"));
    const [a, b, c] = await Promise.all([rescue.recover(), rescue.recover(), rescue.recover()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(engine.calls).toHaveLength(1);
    expect(server.upload).toHaveBeenCalledTimes(2);
  });

  it("times out uploads that never settle", async () => {
    const rescue = createUploadRescue({
      upload: () => new Promise(() => undefined),
      timeout: 30,
      recovery: { enabled: false },
    });
    const state = await rescue.select(makeFile(KB, "a.png", "image/png"));
    expect(state.status).toBe("failed");
    expect(state.failure?.kind).toBe("timeout");
  });

  it("uses the custom classifier for application-specific errors", async () => {
    const upload = vi.fn(async (file: File) => {
      if (file.size > 2 * KB) throw { code: "QUOTA_FILE_TOO_BIG" };
      return "ok";
    });
    const rescue = createUploadRescue({
      upload,
      engines: [fakeEngine({ factor: 0.3 })],
      classifyError: (error) =>
        (error as { code?: string }).code === "QUOTA_FILE_TOO_BIG"
          ? {
              kind: "file-too-large",
              source: "custom",
              message: "Too big",
              retryable: false,
              optimizable: true,
            }
          : null,
    });
    await rescue.select(makeFile(5 * KB, "a.png", "image/png"));
    expect(rescue.getState().recoveryAction).toBe("optimize");
    expect((await rescue.recover()).status).toBe("success");
  });

  it("rejects unaccepted types without attempting recovery", async () => {
    const upload = vi.fn();
    const rescue = createUploadRescue({
      upload,
      acceptedTypes: ["application/pdf"],
      engines: [fakeEngine()],
    });
    const state = await rescue.select(makeFile(KB, "a.png", "image/png"));
    expect(state.status).toBe("failed");
    expect(state.failure?.kind).toBe("unsupported-type");
    expect(upload).not.toHaveBeenCalled();
  });

  it("supports manual upload, reset, new selection and destroy", async () => {
    const upload = vi.fn(async () => "ok");
    const rescue = createUploadRescue({ upload, autoUpload: false });
    let state = await rescue.select(makeFile(KB, "a.png", "image/png"));
    expect(state.status).toBe("file-selected");
    state = await rescue.upload();
    expect(state.status).toBe("success");
    rescue.reset();
    expect(rescue.getState().status).toBe("idle");
    rescue.destroy();
    await expect(rescue.select(makeFile(KB, "a.png", "image/png"))).rejects.toThrow(/destroyed/);
  });

  it("selecting a new file mid-upload cancels the previous one", async () => {
    const first = deferred<string>();
    const upload = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue("second");
    const rescue = createUploadRescue({ upload });
    const run1 = rescue.select(makeFile(KB, "1.png", "image/png"));
    await vi.waitFor(() => expect(rescue.getState().status).toBe("uploading"));
    const state = await rescue.select(makeFile(KB, "2.png", "image/png"));
    first.resolve("first");
    await run1;
    expect(state.status).toBe("success");
    expect(rescue.getState().result).toBe("second");
  });

  it("reports upload progress", async () => {
    const onProgress = vi.fn();
    const rescue = createUploadRescue({
      onProgress,
      upload: async (file, ctx) => {
        ctx.reportProgress(file.size / 2);
        ctx.reportProgress(file.size);
        return "ok";
      },
    });
    await rescue.select(makeFile(KB, "a.png", "image/png"));
    expect(onProgress.mock.calls.map((c) => c[0].ratio)).toEqual([0.5, 1]);
  });
});

describe("optimizeFile / lazyEngine", () => {
  it("rejects outputs whose content does not match the claimed type", async () => {
    const engine = fakeEngine({ outputType: "image/jpeg" });
    await expect(
      optimizeFile(makeFile(4 * KB, "a.png", "image/png"), { engines: [engine] }),
    ).rejects.toMatchObject({
      reason: "invalid-output",
    });
  });

  it("renames files when the format changes", async () => {
    const engine = {
      ...fakeEngine(),
      optimize: async () => ({
        blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])]),
        type: "image/jpeg",
      }),
    };
    const result = await optimizeFile(makeFile(4 * KB, "photo.png", "image/png"), {
      engines: [engine],
    });
    expect(result.file.name).toBe("photo.jpg");
    expect(result.file.type).toBe("image/jpeg");
  });

  it("loads lazy engines only when needed", async () => {
    const load = vi.fn(async () => fakeEngine());
    const engine = lazyEngine({ id: "lazy", supportedTypes: ["image/*"], load });
    expect(load).not.toHaveBeenCalled();
    await expect(
      optimizeFile(
        makeFile(100, "a.pdf", "application/pdf", [...new TextEncoder().encode("%PDF-")]),
        {
          engines: [engine],
        },
      ),
    ).rejects.toMatchObject({ reason: "no-engine" });
    expect(load).not.toHaveBeenCalled();
    const result = await optimizeFile(makeFile(4 * KB, "a.png", "image/png"), {
      engines: [engine],
    });
    expect(result.changed).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  });
});
