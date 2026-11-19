export { UploadRescueController, createUploadRescue } from "./controller";
export type {
  ClassifyContext,
  OptimizationConfig,
  OptimizationFailure,
  OptimizationFailureReason,
  RecoveryAction,
  RecoveryConfig,
  RecoveryEvent,
  RecoveryListener,
  RecoveryState,
  SuccessContext,
  UploadContext,
  UploadFunction,
  UploadProgress,
  UploadRescueConfig,
} from "./types";

export {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  assertTransition,
  canTransition,
  isActiveStatus,
  type RecoveryStatus,
} from "./state";

export {
  DEFAULT_SIZE_ERROR_PATTERNS,
  classifyUploadError,
  createFailure,
  extractServerMaxSize,
  failureFromValidation,
  type ClassifyOptions,
  type UploadFailure,
  type UploadFailureKind,
  type UploadFailureSource,
} from "./classify";

export {
  OptimizationError,
  UploadAbortedError,
  UploadHttpError,
  UploadNetworkError,
  UploadRescueError,
  UploadTimeoutError,
  isAbortError,
  toError,
  type OptimizationErrorReason,
  type UploadHttpErrorInit,
  type UploadRescueErrorCode,
} from "./errors";

export {
  findEngine,
  lazyEngine,
  optimizeFile,
  type EngineOutput,
  type LazyEngine,
  type LazyEngineDefinition,
  type OptimizationContext,
  type OptimizationEngine,
  type OptimizationOptions,
  type OptimizationResult,
  type OptimizeFileOptions,
} from "./engines";

export {
  detectFileType,
  inspectFile,
  sniffMime,
  type DetectedType,
  type DetectionSource,
  type FileInfo,
} from "./detect";

export {
  validateFile,
  validateFileInfo,
  type ValidationIssue,
  type ValidationIssueCode,
  type ValidationResult,
  type ValidationRules,
} from "./validate";

export {
  EXTENSION_TO_MIME,
  MIME_TO_EXTENSION,
  OOXML_TYPES,
  categoryForMime,
  extensionForMime,
  getExtension,
  matchesAccept,
  matchesAcceptPattern,
  mimeFromExtension,
  normalizeMime,
  replaceExtension,
  type FileCategory,
} from "./mime";

export { formatBytes, formatPercent, reductionRatio, type FormatBytesOptions } from "./bytes";
export { delay, linkedAbortController, raceWithSignal, randomId, throwIfAborted } from "./abort";
