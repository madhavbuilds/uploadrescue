/**
 * All user-facing strings. Override any subset via the `labels` option to
 * localise or re-word the widget.
 */
export interface RecoveryLabels {
  idleTitle: string;
  idleDescription: string;
  dropActive: string;
  browse: string;
  readyTitle: string;
  upload: string;
  validating: string;
  uploading: string;
  uploadingOptimized: string;
  retrying: string;
  tooLargeTitle: string;
  tooLargeWithLimit: (limit: string, actual: string) => string;
  tooLargeServer: string;
  networkTitle: string;
  timeoutTitle: string;
  genericFailureTitle: string;
  authTitle: string;
  typeTitle: string;
  serverTitle: string;
  rateLimitedTitle: string;
  compressAndRetry: string;
  retryUpload: string;
  tryStrongerCompression: string;
  chooseAnother: string;
  uploadAnother: string;
  tryAgain: string;
  cancel: string;
  download: string;
  optimizing: string;
  optimizationComplete: string;
  stillTooLargeTitle: string;
  noReductionTitle: string;
  optimizationUnavailableTitle: string;
  optimizationFailedTitle: string;
  noEngineHint: string;
  successTitle: string;
  cancelledTitle: string;
  cancelledDescription: string;
  attemptsExhausted: (attempts: number) => string;
  original: string;
  optimized: string;
  reduction: string;
  maximumAllowed: string;
  yourFile: string;
  processingTime: string;
}

export const DEFAULT_LABELS: RecoveryLabels = {
  idleTitle: "Upload a file",
  idleDescription: "Drag and drop a file here, or browse.",
  dropActive: "Drop the file to upload it",
  browse: "Browse files",
  readyTitle: "Ready to upload",
  upload: "Upload",
  validating: "Checking your file…",
  uploading: "Uploading…",
  uploadingOptimized: "Uploading optimized file…",
  retrying: "Retrying upload…",
  tooLargeTitle: "Your file is too large.",
  tooLargeWithLimit: (limit, actual) => `Maximum allowed: ${limit}. Your file: ${actual}.`,
  tooLargeServer: "The server rejected the file because it is too large.",
  networkTitle: "The upload was interrupted.",
  timeoutTitle: "The upload timed out.",
  genericFailureTitle: "The upload failed.",
  authTitle: "You are not allowed to upload this file.",
  typeTitle: "This file type is not accepted.",
  serverTitle: "The server could not accept the upload.",
  rateLimitedTitle: "Too many uploads.",
  compressAndRetry: "Compress & Retry Upload",
  retryUpload: "Retry upload",
  tryStrongerCompression: "Try stronger compression",
  chooseAnother: "Choose another file",
  uploadAnother: "Upload another file",
  tryAgain: "Try again",
  cancel: "Cancel",
  download: "Download optimized file",
  optimizing: "Optimizing your file…",
  optimizationComplete: "Optimization complete.",
  stillTooLargeTitle: "The optimized file is still too large.",
  noReductionTitle: "This file could not be made smaller.",
  optimizationUnavailableTitle: "This file can't be optimized automatically.",
  optimizationFailedTitle: "Optimization failed.",
  noEngineHint:
    "Automatic optimization isn't available for this file. Please choose a smaller file.",
  successTitle: "Upload completed successfully.",
  cancelledTitle: "Upload cancelled.",
  cancelledDescription: "Your original file was not changed.",
  attemptsExhausted: (n) => `Stopped after ${n} recovery ${n === 1 ? "attempt" : "attempts"}.`,
  original: "Original",
  optimized: "Optimized",
  reduction: "Reduction",
  maximumAllowed: "Maximum allowed",
  yourFile: "Your file",
  processingTime: "Processing time",
};
