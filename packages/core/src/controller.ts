import { linkedAbortController, randomId, raceWithSignal } from "./abort";
import { formatBytes } from "./bytes";
import {
  classifyUploadError,
  createFailure,
  failureFromValidation,
  type UploadFailure,
} from "./classify";
import { inspectFile } from "./detect";
import { findEngine, optimizeFile, type OptimizationResult } from "./engines";
import { OptimizationError, UploadRescueError, UploadTimeoutError, toError } from "./errors";
import { assertTransition, isActiveStatus, type RecoveryStatus } from "./state";
import type {
  OptimizationFailure,
  RecoveryAction,
  RecoveryEvent,
  RecoveryListener,
  RecoveryState,
  UploadContext,
  UploadProgress,
  UploadRescueConfig,
} from "./types";
import { validateFileInfo, type ValidationRules } from "./validate";

const DEFAULTS = {
  quality: 0.82,
  preserveFormat: true,
  optimizationAttempts: 2,
  recoveryAttempts: 3,
  /** When the size limit is unknown, aim for this fraction of the last rejected size. */
  unknownLimitFactor: 0.6,
} as const;

interface Operation {
  controller: AbortController;
  generation: number;
}

function initialState<T>(): RecoveryState<T> {
  return {
    status: "idle",
    originalFile: null,
    fileInfo: null,
    activeFile: null,
    failure: null,
    optimization: null,
    optimizationFailure: null,
    progress: null,
    recoveryAction: null,
    alternativeAction: null,
    attempts: { uploads: 0, recoveries: 0, optimizations: 0 },
    maxRecoveryAttempts: DEFAULTS.recoveryAttempts,
    maxSize: null,
    result: undefined,
    error: null,
    history: [],
    sessionId: null,
  };
}

/**
 * Framework-independent upload recovery controller.
 *
 * Lifecycle: `select(file)` → validate → upload → (failure → recover() →
 * optimize → retry)* → success | failed | cancelled.
 *
 * All state changes go through an explicit transition table, only one
 * operation runs at a time, and every attempt is bounded.
 */
export class UploadRescueController<TResult = unknown> {
  private config: UploadRescueConfig<TResult>;
  private state: RecoveryState<TResult>;
  private readonly listeners = new Set<RecoveryListener<TResult>>();
  private op: Operation | null = null;
  private generation = 0;
  private inflightRecovery: Promise<RecoveryState<TResult>> | null = null;
  /** Server-reported limit learned during this session. */
  private learnedMaxSize: number | null = null;
  private lastRejectedSize: number | null = null;
  private destroyed = false;

  constructor(config: UploadRescueConfig<TResult>) {
    if (typeof config.upload !== "function") {
      throw new TypeError("UploadRescue: `upload` must be a function.");
    }
    this.config = config;
    this.state = {
      ...initialState<TResult>(),
      maxRecoveryAttempts: this.maxRecoveryAttempts,
      maxSize: config.maxSize ?? null,
    };
  }

  // ---------------------------------------------------------------- public API

  getState(): RecoveryState<TResult> {
    return this.state;
  }

  getConfig(): Readonly<UploadRescueConfig<TResult>> {
    return this.config;
  }

  subscribe(listener: RecoveryListener<TResult>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Replaces configuration (e.g. fresh callbacks from a React render). Takes effect for the next step. */
  updateConfig(config: UploadRescueConfig<TResult>): void {
    this.config = config;
    const maxSize = this.effectiveMaxSize();
    if (
      maxSize !== this.state.maxSize ||
      this.state.maxRecoveryAttempts !== this.maxRecoveryAttempts
    ) {
      this.state = { ...this.state, maxSize, maxRecoveryAttempts: this.maxRecoveryAttempts };
      this.emit();
    }
  }

  /**
   * Starts a new session for `file`. Any running operation is cancelled first.
   * Uploads immediately unless `autoUpload` is false.
   */
  async select(file: File): Promise<RecoveryState<TResult>> {
    this.assertAlive();
    if (!(file instanceof Blob)) throw new TypeError("UploadRescue: select() expects a File.");
    if (isActiveStatus(this.state.status)) this.cancel();
    this.abortOp();
    this.learnedMaxSize = null;
    this.lastRejectedSize = null;
    this.inflightRecovery = null;
    const status = this.state.status;
    if (status !== "idle") assertTransition(status, "file-selected");
    this.state = {
      ...initialState<TResult>(),
      status: "file-selected",
      originalFile: file,
      activeFile: file,
      sessionId: randomId(),
      maxSize: this.config.maxSize ?? null,
      maxRecoveryAttempts: this.maxRecoveryAttempts,
    };
    this.emit();
    if (this.config.autoUpload === false) return this.state;
    return this.upload();
  }

  /** Validates and uploads the selected file (only needed when `autoUpload` is false). */
  async upload(): Promise<RecoveryState<TResult>> {
    this.assertAlive();
    if (this.state.status !== "file-selected" || !this.state.originalFile) return this.state;
    const op = this.beginOp();
    const file = this.state.originalFile;

    this.transition("validating");
    const started = Date.now();
    let info;
    try {
      info = await inspectFile(file);
    } catch (error) {
      if (this.isStale(op)) return this.state;
      return this.fail(
        op,
        toError(error),
        createFailure("invalid-file", {
          source: "validation",
          message: "The file could not be read.",
          cause: error,
        }),
      );
    }
    if (this.isStale(op)) return this.state;
    this.patch({ fileInfo: info });

    const issues = validateFileInfo(info, this.validationRules());
    if (issues.length > 0) {
      const issue = issues.find((i) => !i.optimizable) ?? issues[0]!;
      const failure = failureFromValidation(issue);
      this.record({
        type: "validation",
        attempt: 0,
        startedAt: started,
        file,
        outcome: "failure",
        failure,
        message: issue.message,
      });
      if (failure.kind === "file-too-large") this.lastRejectedSize = file.size;
      return this.handleFailure(op, failure, file);
    }

    this.transition("uploading");
    return this.runUpload(op, file, false);
  }

  /**
   * Performs the offered recovery step (`state.recoveryAction`, or the given
   * action when it is currently allowed). Concurrent calls share one run.
   */
  recover(action?: RecoveryAction): Promise<RecoveryState<TResult>> {
    this.assertAlive();
    if (this.inflightRecovery) return this.inflightRecovery;
    const { status, recoveryAction, alternativeAction } = this.state;
    if (status !== "recovery-available" && status !== "optimization-failed") {
      return Promise.resolve(this.state);
    }
    const chosen = action ?? recoveryAction;
    if (!chosen || (chosen !== recoveryAction && chosen !== alternativeAction)) {
      return Promise.resolve(this.state);
    }
    const run = this.runRecovery(chosen).finally(() => {
      if (this.inflightRecovery === run) this.inflightRecovery = null;
    });
    this.inflightRecovery = run;
    return run;
  }

  /** Cancels the running operation. The original file is kept so the user can try again. */
  cancel(): void {
    if (this.destroyed) return;
    const { status } = this.state;
    if (
      status === "idle" ||
      status === "success" ||
      status === "failed" ||
      status === "cancelled" ||
      status === "upload-failed"
    ) {
      return;
    }
    const wasActive = isActiveStatus(status);
    this.abortOp();
    this.inflightRecovery = null;
    if (wasActive) {
      const file = this.state.activeFile;
      if (file) {
        const type =
          status === "optimizing"
            ? "optimization"
            : status === "validating"
              ? "validation"
              : "upload";
        this.record({
          type,
          attempt: this.state.attempts.uploads,
          startedAt: Date.now(),
          file,
          outcome: "cancelled",
        });
      }
    }
    this.transition("cancelled", { progress: null, recoveryAction: null, alternativeAction: null });
  }

  /** Returns to `idle`, cancelling any running operation. */
  reset(): void {
    if (this.destroyed) return;
    if (this.state.status === "idle") return;
    if (isActiveStatus(this.state.status)) this.cancel();
    this.abortOp();
    this.inflightRecovery = null;
    this.learnedMaxSize = null;
    this.lastRejectedSize = null;
    assertTransition(this.state.status, "idle");
    this.state = {
      ...initialState<TResult>(),
      maxSize: this.config.maxSize ?? null,
      maxRecoveryAttempts: this.maxRecoveryAttempts,
    };
    this.emit();
  }

  /** Cancels work and removes all listeners. The controller cannot be used afterwards. */
  destroy(): void {
    if (this.destroyed) return;
    this.abortOp();
    this.destroyed = true;
    this.listeners.clear();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // ------------------------------------------------------------- recovery flow

  private async runRecovery(action: RecoveryAction): Promise<RecoveryState<TResult>> {
    const op = this.beginOp();
    this.patch({
      attempts: { ...this.state.attempts, recoveries: this.state.attempts.recoveries + 1 },
    });
    if (action === "retry") {
      const file = this.state.activeFile ?? this.state.originalFile!;
      this.transition("retrying", { progress: null });
      return this.runUpload(op, file, true);
    }

    const optimized = await this.runOptimization(op);
    if (!optimized || this.isStale(op)) return this.state;
    this.transition("retrying", { progress: null });
    return this.runUpload(op, optimized, true);
  }

  private async runOptimization(op: Operation): Promise<File | null> {
    const original = this.state.originalFile!;
    const attempt = this.state.attempts.optimizations;
    const opt = this.config.optimization ?? {};
    const targetSize = this.computeTargetSize();
    this.transition("optimizing", {
      optimizationFailure: null,
      progress: { phase: "optimize", ratio: null, attempt },
      attempts: { ...this.state.attempts, optimizations: attempt + 1 },
    });

    const started = Date.now();
    let result: OptimizationResult;
    try {
      const allowedOutputTypes = this.config.acceptedTypes;
      result = await optimizeFile(original, {
        engines: this.config.engines ?? [],
        signal: op.controller.signal,
        quality: opt.quality ?? DEFAULTS.quality,
        preserveFormat: opt.preserveFormat ?? DEFAULTS.preserveFormat,
        attempt,
        ...(targetSize !== undefined ? { targetSize } : {}),
        ...(opt.maxDimension !== undefined ? { maxDimension: opt.maxDimension } : {}),
        ...(allowedOutputTypes ? { allowedOutputTypes } : {}),
        ...(this.state.fileInfo ? { info: this.state.fileInfo } : {}),
        onProgress: (ratio, stage) => {
          if (this.isStale(op)) return;
          this.setProgress({ phase: "optimize", ratio, attempt, ...(stage ? { stage } : {}) });
        },
      });
    } catch (error) {
      if (this.isStale(op)) return null;
      const reason = error instanceof OptimizationError ? error.reason : "failed";
      if (reason === "aborted") return null;
      const message = error instanceof Error ? error.message : "Optimization failed.";
      this.record({
        type: "optimization",
        attempt,
        startedAt: started,
        file: original,
        outcome: "failure",
        message,
      });
      this.config.onError?.(toError(error), null);
      this.enterOptimizationFailed({ reason, message }, null);
      return null;
    }
    if (this.isStale(op)) return null;

    this.record({
      type: "optimization",
      attempt,
      startedAt: started,
      file: original,
      outcome: result.changed ? "success" : "failure",
      optimization: {
        engine: result.engine,
        originalSize: result.originalSize,
        outputSize: result.outputSize,
        durationMs: result.durationMs,
        withinTarget: result.withinTarget,
        changed: result.changed,
      },
    });

    if (!result.changed) {
      this.enterOptimizationFailed(
        { reason: "no-reduction", message: "This file could not be made any smaller." },
        result,
      );
      return null;
    }

    const outputInfo = await inspectFile(result.file);
    if (this.isStale(op)) return null;
    const hardLimit = this.effectiveMaxSize();
    const issues = validateFileInfo(outputInfo, {
      ...this.validationRules(),
      ...(hardLimit !== null ? { maxSize: hardLimit } : {}),
    });
    const tooLarge = issues.find((i) => i.code === "file-too-large");
    if (tooLarge) {
      this.enterOptimizationFailed(
        {
          reason: "target-not-reached",
          message: `The optimized file is still too large. Maximum allowed: ${formatBytes(hardLimit!)}. Optimized: ${formatBytes(result.outputSize)}.`,
        },
        result,
      );
      return null;
    }
    if (issues.length > 0) {
      this.enterOptimizationFailed(
        { reason: "rejected-output", message: issues[0]!.message },
        result,
      );
      return null;
    }

    this.transition("optimization-complete", {
      optimization: result,
      activeFile: result.file,
      progress: null,
    });
    this.config.onOptimization?.(original, result.file, result);
    return result.file;
  }

  private enterOptimizationFailed(
    failure: OptimizationFailure,
    result: OptimizationResult | null,
  ): void {
    const canTryHarder =
      (failure.reason === "target-not-reached" || failure.reason === "no-reduction") &&
      this.state.attempts.optimizations < this.maxOptimizationAttempts &&
      this.state.attempts.recoveries < this.maxRecoveryAttempts;
    this.transition("optimization-failed", {
      optimizationFailure: failure,
      optimization: result,
      progress: null,
      recoveryAction: canTryHarder ? "optimize" : null,
      alternativeAction: null,
    });
  }

  private async runUpload(
    op: Operation,
    file: File,
    isRetry: boolean,
  ): Promise<RecoveryState<TResult>> {
    const attempt = this.state.attempts.uploads + 1;
    this.patch({
      activeFile: file,
      attempts: { ...this.state.attempts, uploads: attempt },
      progress: { phase: "upload", ratio: null, attempt, total: file.size },
    });
    const { controller: attemptController, dispose } = linkedAbortController(op.controller.signal);
    const timeout = this.config.timeout;
    const timer =
      timeout && timeout > 0
        ? setTimeout(() => attemptController.abort(new UploadTimeoutError(timeout)), timeout)
        : undefined;

    const context: UploadContext = {
      attempt,
      isRetry,
      originalFile: this.state.originalFile!,
      optimization: file === this.state.originalFile ? null : this.state.optimization,
      signal: attemptController.signal,
      idempotencyKey: this.state.sessionId!,
      attemptId: randomId(),
      previousFailure: this.state.failure,
      reportProgress: (loaded, total) => {
        if (this.isStale(op) || attemptController.signal.aborted) return;
        const t = total ?? file.size;
        this.setProgress({
          phase: "upload",
          ratio: t > 0 ? Math.min(1, loaded / t) : null,
          loaded,
          total: t,
          attempt,
        });
      },
    };

    const started = Date.now();
    let result: TResult | undefined;
    let error: unknown = null;
    let ok = false;
    try {
      result = await raceWithSignal(
        Promise.resolve().then(() => this.config.upload(file, context)),
        attemptController.signal,
      );
      ok = true;
    } catch (e) {
      error = e;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      dispose();
    }

    if (this.isStale(op)) return this.state;

    if (ok) {
      this.record({ type: "upload", attempt, startedAt: started, file, outcome: "success" });
      this.transition("success", {
        result,
        failure: null,
        progress: { phase: "upload", ratio: 1, attempt, loaded: file.size, total: file.size },
        recoveryAction: null,
        alternativeAction: null,
      });
      this.endOp(op);
      this.config.onSuccess?.(result as TResult, {
        file,
        originalFile: this.state.originalFile!,
        optimized: file !== this.state.originalFile,
        attempt,
      });
      return this.state;
    }

    const failure = this.classify(error, file, attempt);
    if (failure.kind === "cancelled") {
      this.record({ type: "upload", attempt, startedAt: started, file, outcome: "cancelled" });
      this.transition("cancelled", { progress: null });
      this.endOp(op);
      return this.state;
    }
    this.record({ type: "upload", attempt, startedAt: started, file, outcome: "failure", failure });
    if (failure.kind === "file-too-large") {
      this.lastRejectedSize = file.size;
      if (failure.serverMaxSize) {
        this.learnedMaxSize = Math.min(this.learnedMaxSize ?? Infinity, failure.serverMaxSize);
      }
    }
    this.config.onError?.(toError(error), failure);
    return this.handleFailure(op, failure, file);
  }

  private async handleFailure(
    op: Operation,
    failure: UploadFailure,
    file: File,
  ): Promise<RecoveryState<TResult>> {
    this.transition("upload-failed", { failure, progress: null, maxSize: this.effectiveMaxSize() });
    const { primary, alternative } = await this.decideRecovery(failure);
    if (this.isStale(op)) return this.state;

    if (!primary) {
      const error =
        failure.cause instanceof Error
          ? failure.cause
          : new UploadRescueError("http-error", failure.message);
      this.transition("failed", { error, recoveryAction: null, alternativeAction: null });
      this.endOp(op);
      return this.state;
    }

    this.transition("recovery-available", {
      recoveryAction: primary,
      alternativeAction: alternative,
      activeFile: file,
    });
    this.endOp(op);
    if (this.config.recovery?.autoRetry) {
      // We may be running inside a previous recovery; release it so recover()
      // starts a new bounded run instead of returning the pending one.
      // Bounded by maxAttempts: recover() increments the counter before running.
      this.inflightRecovery = null;
      return this.recover();
    }
    return this.state;
  }

  private async decideRecovery(
    failure: UploadFailure,
  ): Promise<{ primary: RecoveryAction | null; alternative: RecoveryAction | null }> {
    const none = { primary: null, alternative: null };
    if (this.config.recovery?.enabled === false) return none;
    if (this.state.attempts.recoveries >= this.maxRecoveryAttempts) return none;

    const canRetry = failure.retryable;
    let canOptimize = false;
    if (
      failure.optimizable &&
      this.config.optimization?.enabled !== false &&
      this.state.attempts.optimizations < this.maxOptimizationAttempts &&
      this.state.originalFile
    ) {
      const info = this.state.fileInfo ?? (await inspectFile(this.state.originalFile));
      const engine = await findEngine(this.config.engines ?? [], this.state.originalFile, info);
      canOptimize = engine !== null;
    }

    if (failure.kind === "file-too-large") {
      return { primary: canOptimize ? "optimize" : null, alternative: null };
    }
    if (canRetry) return { primary: "retry", alternative: canOptimize ? "optimize" : null };
    return { primary: canOptimize ? "optimize" : null, alternative: null };
  }

  // ------------------------------------------------------------------ helpers

  private classify(error: unknown, file: File, attempt: number): UploadFailure {
    if (error instanceof UploadTimeoutError) return classifyUploadError(error, this.config.errors);
    if (this.config.classifyError) {
      try {
        const custom = this.config.classifyError(error, { file, attempt });
        if (custom) return custom;
      } catch (classifierError) {
        this.config.onError?.(toError(classifierError), null);
      }
    }
    return classifyUploadError(error, this.config.errors);
  }

  private computeTargetSize(): number | undefined {
    const candidates: number[] = [];
    const opt = this.config.optimization;
    if (opt?.targetSize !== undefined) candidates.push(opt.targetSize);
    const limit = this.effectiveMaxSize();
    if (limit !== null) candidates.push(limit);
    const failure = this.state.failure;
    const serverRejectedWithoutLimit =
      failure?.kind === "file-too-large" &&
      failure.source !== "validation" &&
      !failure.serverMaxSize;
    if ((serverRejectedWithoutLimit || candidates.length === 0) && this.lastRejectedSize) {
      candidates.push(Math.floor(this.lastRejectedSize * DEFAULTS.unknownLimitFactor));
    }
    return candidates.length > 0 ? Math.min(...candidates) : undefined;
  }

  private effectiveMaxSize(): number | null {
    const limits = [this.config.maxSize, this.learnedMaxSize].filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v),
    );
    return limits.length > 0 ? Math.min(...limits) : null;
  }

  private validationRules(): ValidationRules {
    const rules: ValidationRules = {};
    const max = this.effectiveMaxSize();
    if (max !== null) rules.maxSize = max;
    if (this.config.acceptedTypes) rules.acceptedTypes = this.config.acceptedTypes;
    if (this.config.rejectTypeMismatch) rules.rejectTypeMismatch = true;
    return rules;
  }

  private get maxRecoveryAttempts(): number {
    return Math.max(0, this.config.recovery?.maxAttempts ?? DEFAULTS.recoveryAttempts);
  }

  private get maxOptimizationAttempts(): number {
    return Math.max(0, this.config.optimization?.maxAttempts ?? DEFAULTS.optimizationAttempts);
  }

  private fail(op: Operation, error: Error, failure: UploadFailure): RecoveryState<TResult> {
    this.transition("upload-failed", { failure });
    this.transition("failed", { error });
    this.endOp(op);
    return this.state;
  }

  private beginOp(): Operation {
    this.abortOp();
    this.generation += 1;
    const op = { controller: new AbortController(), generation: this.generation };
    this.op = op;
    return op;
  }

  private endOp(op: Operation): void {
    if (this.op === op) this.op = null;
  }

  private abortOp(): void {
    if (this.op) {
      this.op.controller.abort();
      this.op = null;
    }
    this.generation += 1;
  }

  private isStale(op: Operation): boolean {
    return this.destroyed || op.generation !== this.generation || op.controller.signal.aborted;
  }

  private transition(status: RecoveryStatus, patch: Partial<RecoveryState<TResult>> = {}): void {
    assertTransition(this.state.status, status);
    this.state = { ...this.state, ...patch, status };
    this.emit();
  }

  private patch(patch: Partial<RecoveryState<TResult>>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private setProgress(progress: UploadProgress): void {
    const prev = this.state.progress;
    // Skip sub-0.5% updates to avoid flooding renderers.
    if (
      prev &&
      prev.phase === progress.phase &&
      prev.ratio !== null &&
      progress.ratio !== null &&
      progress.ratio < 1 &&
      Math.abs(progress.ratio - prev.ratio) < 0.005 &&
      prev.stage === progress.stage
    ) {
      return;
    }
    this.patch({ progress });
    this.config.onProgress?.(progress);
  }

  private record(event: {
    type: RecoveryEvent["type"];
    attempt: number;
    startedAt: number;
    file: File;
    outcome: RecoveryEvent["outcome"];
    failure?: UploadFailure;
    optimization?: RecoveryEvent["optimization"];
    message?: string;
  }): void {
    const entry: RecoveryEvent = {
      id: randomId(),
      type: event.type,
      attempt: event.attempt,
      startedAt: event.startedAt,
      endedAt: Date.now(),
      fileName: event.file.name,
      fileSize: event.file.size,
      outcome: event.outcome,
      ...(event.failure ? { failure: event.failure } : {}),
      ...(event.optimization ? { optimization: event.optimization } : {}),
      ...(event.message ? { message: event.message } : {}),
    };
    this.state = { ...this.state, history: [...this.state.history, entry] };
  }

  private emit(): void {
    const snapshot = this.state;
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        // A faulty listener must not break the state machine, but must not be silent either.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
    try {
      this.config.onStateChange?.(snapshot);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }

  private assertAlive(): void {
    if (this.destroyed)
      throw new UploadRescueError("destroyed", "This UploadRescue instance was destroyed.");
  }
}

/** Creates an upload recovery controller. */
export function createUploadRescue<TResult = unknown>(
  config: UploadRescueConfig<TResult>,
): UploadRescueController<TResult> {
  return new UploadRescueController(config);
}
