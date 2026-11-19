const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export interface FormatBytesOptions {
  /** Maximum fraction digits. Trailing zeros are removed. Default 1. */
  decimals?: number;
}

/**
 * Formats a byte count using binary multiples (1 KB = 1024 B), which is how
 * most upload limits are configured (`2 * 1024 * 1024`).
 */
export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  const decimals = options.decimals ?? 1;
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return `${rounded} ${UNITS[unit]}`;
}

/** Fractional reduction between two sizes, clamped to [0, 1]. Returns 0 when output >= original. */
export function reductionRatio(originalSize: number, outputSize: number): number {
  if (originalSize <= 0 || outputSize >= originalSize) return 0;
  return (originalSize - outputSize) / originalSize;
}

/** Formats a reduction ratio as a percentage with one decimal, e.g. `79.8%`. */
export function formatPercent(ratio: number, decimals = 1): string {
  const factor = 10 ** decimals;
  return `${Math.round(ratio * 100 * factor) / factor}%`;
}
