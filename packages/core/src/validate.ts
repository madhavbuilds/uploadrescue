import { formatBytes } from "./bytes";
import { inspectFile, type FileInfo } from "./detect";
import { matchesAccept } from "./mime";

export interface ValidationRules {
  /** Maximum size in bytes. */
  maxSize?: number;
  /** Minimum size in bytes. */
  minSize?: number;
  /** `accept`-style patterns: `"image/*"`, `"application/pdf"`, `".pdf"`. */
  acceptedTypes?: readonly string[];
  /** Allow zero-byte files. Default false. */
  allowEmpty?: boolean;
  /**
   * Reject files whose content signature contradicts their declared type or
   * extension. Default false (mismatches are reported on `FileInfo` only).
   */
  rejectTypeMismatch?: boolean;
}

export type ValidationIssueCode =
  "file-too-large" | "file-too-small" | "file-empty" | "type-not-accepted" | "type-mismatch";

export interface ValidationIssue {
  code: ValidationIssueCode;
  message: string;
  /** True when optimizing the file could resolve the issue. */
  optimizable: boolean;
  limit?: number;
  actual?: number;
}

export interface ValidationResult {
  valid: boolean;
  info: FileInfo;
  issues: ValidationIssue[];
}

/**
 * Pure validation against already-extracted file info.
 *
 * Accepted types are matched against the content-detected type when a
 * signature was found, so renaming `malware.exe` to `photo.jpg` does not pass
 * an `image/*` rule.
 */
export function validateFileInfo(info: FileInfo, rules: ValidationRules): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (info.size === 0 && !rules.allowEmpty) {
    issues.push({ code: "file-empty", message: "The selected file is empty.", optimizable: false });
    return issues;
  }
  if (rules.acceptedTypes && rules.acceptedTypes.length > 0) {
    const accepted = matchesAccept(info.detected.mime, info.name, rules.acceptedTypes);
    if (!accepted) {
      issues.push({
        code: "type-not-accepted",
        message: `This file type (${info.detected.extension || info.detected.mime}) is not accepted.`,
        optimizable: false,
      });
    }
  }
  if (rules.rejectTypeMismatch && info.typeMismatch) {
    issues.push({
      code: "type-mismatch",
      message: "The file content does not match its name or declared type.",
      optimizable: false,
    });
  }
  if (rules.maxSize !== undefined && info.size > rules.maxSize) {
    issues.push({
      code: "file-too-large",
      message: `Your file is too large. Maximum allowed: ${formatBytes(rules.maxSize)}. Your file: ${formatBytes(info.size)}.`,
      optimizable: true,
      limit: rules.maxSize,
      actual: info.size,
    });
  }
  if (rules.minSize !== undefined && info.size < rules.minSize) {
    issues.push({
      code: "file-too-small",
      message: `The file is smaller than the minimum of ${formatBytes(rules.minSize)}.`,
      optimizable: false,
      limit: rules.minSize,
      actual: info.size,
    });
  }
  return issues;
}

/** Inspects and validates a file. Reads only the first bytes of the file. */
export async function validateFile(file: File, rules: ValidationRules): Promise<ValidationResult> {
  const info = await inspectFile(file);
  const issues = validateFileInfo(info, rules);
  return { valid: issues.length === 0, info, issues };
}
