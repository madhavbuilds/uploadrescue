import { UploadRescueError } from "./errors";

export type RecoveryStatus =
  | "idle"
  | "file-selected"
  | "validating"
  | "uploading"
  | "upload-failed"
  | "recovery-available"
  | "optimizing"
  | "optimization-failed"
  | "optimization-complete"
  | "retrying"
  | "success"
  | "failed"
  | "cancelled";

/**
 * Every allowed transition. Anything not listed is a programming error and
 * throws `UploadRescueError("invalid-transition")`.
 */
export const TRANSITIONS: Readonly<Record<RecoveryStatus, readonly RecoveryStatus[]>> = {
  idle: ["file-selected"],
  "file-selected": ["validating", "cancelled", "idle", "file-selected"],
  validating: ["uploading", "upload-failed", "cancelled"],
  uploading: ["success", "upload-failed", "cancelled"],
  "upload-failed": ["recovery-available", "failed"],
  "recovery-available": ["optimizing", "retrying", "cancelled", "idle", "file-selected"],
  optimizing: ["optimization-complete", "optimization-failed", "cancelled"],
  "optimization-complete": ["retrying", "cancelled"],
  "optimization-failed": ["optimizing", "cancelled", "idle", "file-selected"],
  retrying: ["success", "upload-failed", "cancelled"],
  success: ["idle", "file-selected"],
  failed: ["idle", "file-selected"],
  cancelled: ["idle", "file-selected"],
};

/** States in which an asynchronous operation is running. */
export const ACTIVE_STATUSES: readonly RecoveryStatus[] = [
  "validating",
  "uploading",
  "optimizing",
  "optimization-complete",
  "retrying",
];

export const TERMINAL_STATUSES: readonly RecoveryStatus[] = ["success", "failed", "cancelled"];

export function canTransition(from: RecoveryStatus, to: RecoveryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RecoveryStatus, to: RecoveryStatus): void {
  if (!canTransition(from, to)) {
    throw new UploadRescueError("invalid-transition", `Invalid state transition: ${from} → ${to}`);
  }
}

export function isActiveStatus(status: RecoveryStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
