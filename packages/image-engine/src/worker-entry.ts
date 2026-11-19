/**
 * Web Worker entry. Bundled into a string by scripts/build-worker.mjs and
 * started from a Blob URL, so it works with any bundler (or none).
 */
import { PipelineError, offscreenEnv, runRasterPipeline, type RasterJob } from "./pipeline";

export interface WorkerRequest {
  id: number;
  job: RasterJob;
}

export type WorkerResponse =
  | { id: number; type: "progress"; ratio: number | null; stage?: string }
  | { id: number; type: "result"; result: Awaited<ReturnType<typeof runRasterPipeline>> }
  | { id: number; type: "error"; reason: PipelineError["reason"]; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, job } = event.data;
  const signal = { aborted: false };
  runRasterPipeline(job, offscreenEnv(), signal, (ratio, stage) =>
    scope.postMessage({ id, type: "progress", ratio, ...(stage ? { stage } : {}) }),
  ).then(
    (result) => scope.postMessage({ id, type: "result", result }),
    (error: unknown) => {
      const reason = error instanceof PipelineError ? error.reason : "failed";
      scope.postMessage({
        id,
        type: "error",
        reason,
        message: (error as Error)?.message ?? String(error),
      });
    },
  );
};
