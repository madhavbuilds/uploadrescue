import {
  formatBytes,
  formatPercent,
  type RecoveryState,
  type RecoveryStatus,
  type UploadFailure,
} from "@uploadrescue/core";
import { DEFAULT_LABELS, type RecoveryLabels } from "./labels";

export type ViewTone = "neutral" | "progress" | "error" | "warning" | "success";

export type ViewActionId =
  | "select"
  | "upload"
  | "recover"
  | "recover-alternative"
  | "cancel"
  | "reset"
  | "restart"
  | "download";

export interface ViewAction {
  id: ViewActionId;
  label: string;
  variant: "primary" | "secondary" | "ghost";
}

export interface ViewStat {
  id: "original" | "optimized" | "reduction" | "limit" | "size" | "time";
  label: string;
  value: string;
}

export interface RecoveryView {
  status: RecoveryStatus;
  tone: ViewTone;
  title: string;
  description: string | null;
  file: { name: string; size: string } | null;
  stats: ViewStat[];
  /** null = no progress bar; value null = indeterminate. */
  progress: { value: number | null; label: string } | null;
  actions: ViewAction[];
  busy: boolean;
  /** Show the drop zone / file picker. */
  selectable: boolean;
  /** Text for an aria-live region. */
  announcement: string;
  /** Use an assertive live region (errors). */
  urgent: boolean;
}

export interface RecoveryViewOptions {
  labels?: Partial<RecoveryLabels>;
  /** Show the recovery button(s). Mirrors `recovery.showButton`. Default true. */
  showRecoveryButton?: boolean;
  /** Offer "Download optimized file" when an optimized file exists but cannot be uploaded. Default true. */
  allowDownload?: boolean;
}

export function resolveLabels(labels?: Partial<RecoveryLabels>): RecoveryLabels {
  return labels ? { ...DEFAULT_LABELS, ...labels } : DEFAULT_LABELS;
}

function failureTitle(failure: UploadFailure | null, l: RecoveryLabels): string {
  switch (failure?.kind) {
    case "file-too-large":
      return l.tooLargeTitle;
    case "network":
      return l.networkTitle;
    case "timeout":
      return l.timeoutTitle;
    case "auth":
      return l.authTitle;
    case "unsupported-type":
      return l.typeTitle;
    case "server":
      return l.serverTitle;
    case "rate-limited":
      return l.rateLimitedTitle;
    default:
      return l.genericFailureTitle;
  }
}

function failureDescription(state: RecoveryState, l: RecoveryLabels): string | null {
  const failure = state.failure;
  if (!failure) return null;
  if (failure.kind === "file-too-large") {
    const size = state.activeFile?.size ?? state.originalFile?.size;
    if (state.maxSize !== null && size !== undefined) {
      return l.tooLargeWithLimit(formatBytes(state.maxSize), formatBytes(size));
    }
    return failure.source === "validation" ? failure.message : l.tooLargeServer;
  }
  return failure.message;
}

function optimizationStats(state: RecoveryState, l: RecoveryLabels, withTime = false): ViewStat[] {
  const r = state.optimization;
  if (!r) return [];
  const stats: ViewStat[] = [
    { id: "original", label: l.original, value: formatBytes(r.originalSize) },
    { id: "optimized", label: l.optimized, value: formatBytes(r.outputSize) },
  ];
  if (r.changed)
    stats.push({ id: "reduction", label: l.reduction, value: formatPercent(r.reduction) });
  if (withTime) stats.push({ id: "time", label: l.processingTime, value: `${r.durationMs} ms` });
  return stats;
}

function progressOf(state: RecoveryState, label: string): RecoveryView["progress"] {
  const p = state.progress;
  return { value: p && p.ratio !== null ? p.ratio : null, label };
}

/**
 * Maps a controller state to everything a UI needs to render. Pure function;
 * shared by the React and Vanilla integrations so they behave identically.
 * Only real, calculated values are ever displayed.
 */
export function getRecoveryView(
  state: RecoveryState,
  options: RecoveryViewOptions = {},
): RecoveryView {
  const l = resolveLabels(options.labels);
  const showRecovery = options.showRecoveryButton ?? true;
  const allowDownload = options.allowDownload ?? true;
  const source = state.originalFile;
  const file = source ? { name: source.name, size: formatBytes(source.size) } : null;
  const base = {
    status: state.status,
    file,
    stats: [] as ViewStat[],
    progress: null as RecoveryView["progress"],
    actions: [] as ViewAction[],
    busy: false,
    selectable: false,
    description: null as string | null,
    urgent: false,
  };
  const view = (
    v: Omit<RecoveryView, "announcement"> & { announcement?: string },
  ): RecoveryView => ({
    ...v,
    announcement: v.announcement ?? [v.title, v.description].filter(Boolean).join(" "),
  });
  const chooseAnother: ViewAction = { id: "reset", label: l.chooseAnother, variant: "ghost" };

  switch (state.status) {
    case "idle":
      return view({
        ...base,
        tone: "neutral",
        title: l.idleTitle,
        description: l.idleDescription,
        selectable: true,
        actions: [{ id: "select", label: l.browse, variant: "primary" }],
        announcement: "",
      });
    case "file-selected":
      return view({
        ...base,
        tone: "neutral",
        title: l.readyTitle,
        actions: [{ id: "upload", label: l.upload, variant: "primary" }, chooseAnother],
      });
    case "validating":
      return view({
        ...base,
        tone: "progress",
        title: l.validating,
        busy: true,
        progress: progressOf(state, l.validating),
      });
    case "uploading":
      return view({
        ...base,
        tone: "progress",
        title: l.uploading,
        busy: true,
        progress: progressOf(state, l.uploading),
        actions: [{ id: "cancel", label: l.cancel, variant: "secondary" }],
      });
    case "upload-failed":
      return view({
        ...base,
        tone: "error",
        title: failureTitle(state.failure, l),
        description: failureDescription(state, l),
        busy: true,
        urgent: true,
      });
    case "recovery-available": {
      const actions: ViewAction[] = [];
      if (showRecovery && state.recoveryAction) {
        actions.push({
          id: "recover",
          label: state.recoveryAction === "optimize" ? l.compressAndRetry : l.retryUpload,
          variant: "primary",
        });
        if (state.alternativeAction) {
          actions.push({
            id: "recover-alternative",
            label: state.alternativeAction === "optimize" ? l.compressAndRetry : l.retryUpload,
            variant: "secondary",
          });
        }
      }
      actions.push(chooseAnother);
      // The description already states the limit and the file size; no duplicate stat cards.
      return view({
        ...base,
        tone: "error",
        title: failureTitle(state.failure, l),
        description: failureDescription(state, l),
        actions,
        urgent: true,
      });
    }
    case "optimizing":
      return view({
        ...base,
        tone: "progress",
        title: l.optimizing,
        busy: true,
        stats: source
          ? [{ id: "original", label: l.original, value: formatBytes(source.size) }]
          : [],
        progress: progressOf(state, state.progress?.stage ?? l.optimizing),
        actions: [{ id: "cancel", label: l.cancel, variant: "secondary" }],
      });
    case "optimization-complete":
      return view({
        ...base,
        tone: "success",
        title: l.optimizationComplete,
        busy: true,
        stats: optimizationStats(state, l, true),
      });
    case "retrying": {
      const optimized = !!state.optimization && state.activeFile !== state.originalFile;
      return view({
        ...base,
        tone: "progress",
        title: optimized ? l.uploadingOptimized : l.retrying,
        busy: true,
        stats: optimized ? optimizationStats(state, l) : [],
        progress: progressOf(state, optimized ? l.uploadingOptimized : l.retrying),
        actions: [{ id: "cancel", label: l.cancel, variant: "secondary" }],
      });
    }
    case "success":
      return view({
        ...base,
        tone: "success",
        title: l.successTitle,
        stats: state.activeFile !== state.originalFile ? optimizationStats(state, l) : [],
        actions: [{ id: "reset", label: l.uploadAnother, variant: "secondary" }],
      });
    case "optimization-failed": {
      const f = state.optimizationFailure;
      const title =
        f?.reason === "target-not-reached"
          ? l.stillTooLargeTitle
          : f?.reason === "no-reduction"
            ? l.noReductionTitle
            : f?.reason === "unsupported" ||
                f?.reason === "no-engine" ||
                f?.reason === "environment"
              ? l.optimizationUnavailableTitle
              : l.optimizationFailedTitle;
      const stats = optimizationStats(state, l).filter(
        (s) => s.id !== "reduction" || f?.reason !== "no-reduction",
      );
      if (state.maxSize !== null) {
        stats.splice(1, 0, {
          id: "limit",
          label: l.maximumAllowed,
          value: formatBytes(state.maxSize),
        });
      }
      const actions: ViewAction[] = [];
      if (showRecovery && state.recoveryAction) {
        actions.push({ id: "recover", label: l.tryStrongerCompression, variant: "primary" });
      }
      if (allowDownload && state.optimization?.changed) {
        actions.push({ id: "download", label: l.download, variant: "secondary" });
      }
      actions.push(chooseAnother);
      return view({
        ...base,
        tone: "warning",
        title,
        description: f?.message ?? null,
        stats,
        actions,
        urgent: true,
      });
    }
    case "failed": {
      const exhausted =
        state.attempts.recoveries > 0 && state.attempts.recoveries >= state.maxRecoveryAttempts
          ? l.attemptsExhausted(state.attempts.recoveries)
          : null;
      const noEngine = state.failure?.kind === "file-too-large" ? l.noEngineHint : null;
      const description = [failureDescription(state, l), exhausted ?? noEngine]
        .filter(Boolean)
        .join(" ");
      return view({
        ...base,
        tone: "error",
        title: failureTitle(state.failure, l),
        description: description || null,
        stats: optimizationStats(state, l),
        actions: [chooseAnother],
        urgent: true,
      });
    }
    case "cancelled":
      return view({
        ...base,
        tone: "neutral",
        title: l.cancelledTitle,
        description: l.cancelledDescription,
        actions: [{ id: "restart", label: l.tryAgain, variant: "primary" }, chooseAnother],
      });
  }
}
