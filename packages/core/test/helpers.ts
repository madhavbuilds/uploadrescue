import type { EngineOutput, OptimizationEngine, OptimizationOptions } from "../src";

export const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0];
export const PDF_SIG = [...new TextEncoder().encode("%PDF-1.7\n")];

/** Creates a File whose content starts with `signature` padded to `size` bytes. */
export function makeFile(
  size: number,
  name: string,
  type: string,
  signature: number[] = PNG_SIG,
): File {
  const bytes = new Uint8Array(size);
  bytes.set(signature.slice(0, size));
  for (let i = signature.length; i < size; i += 1) bytes[i] = (i * 31) % 251;
  return new File([bytes], name, { type, lastModified: 1_700_000_000_000 });
}

export interface FakeEngineOptions {
  /** Output size as a fraction of the input. */
  factor?: number;
  /** Fixed output size. */
  outputSize?: number;
  delayMs?: number;
  fail?: Error;
  supportedTypes?: string[];
  outputType?: string;
}

export interface FakeEngine extends OptimizationEngine {
  calls: OptimizationOptions[];
}

/** Deterministic engine that "compresses" by truncation while keeping the signature. */
export function fakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const calls: OptimizationOptions[] = [];
  return {
    id: "fake",
    supportedTypes: options.supportedTypes ?? ["image/*"],
    calls,
    canProcess: () => true,
    async optimize(file, opts, ctx): Promise<EngineOutput> {
      calls.push(opts);
      ctx.onProgress(0.5, "working");
      if (options.delayMs) {
        await new Promise<void>((resolve, reject) => {
          if (ctx.signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
          const t = setTimeout(resolve, options.delayMs);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      if (options.fail) throw options.fail;
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Later attempts compress harder, like real engines.
      const factor = (options.factor ?? 0.5) / (opts.attempt + 1);
      const size = options.outputSize ?? Math.max(16, Math.floor(bytes.length * factor));
      const out = new Uint8Array(size);
      out.set(bytes.subarray(0, Math.min(size, bytes.length)));
      return { blob: new Blob([out]), type: options.outputType ?? file.type, notes: ["fake"] };
    },
  };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
