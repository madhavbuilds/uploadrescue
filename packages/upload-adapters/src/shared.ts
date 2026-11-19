import type { UploadContext } from "@uploadrescue/core";

export type MaybePromise<T> = T | Promise<T>;
export type PerAttempt<T> = T | ((file: File, context: UploadContext) => MaybePromise<T>);

export async function resolvePerAttempt<T>(
  value: PerAttempt<T> | undefined,
  file: File,
  context: UploadContext,
): Promise<T | undefined> {
  if (typeof value === "function")
    return (value as (f: File, c: UploadContext) => MaybePromise<T>)(file, context);
  return value;
}

export interface BodyOptions {
  /** `multipart` sends FormData; `raw` sends the file as the request body. Default `multipart`. */
  body?: "multipart" | "raw";
  /** Multipart field name for the file. Default `file`. */
  fieldName?: string;
  /** Extra multipart fields, evaluated per attempt. */
  fields?: PerAttempt<Record<string, string>>;
}

export async function buildBody(
  file: File,
  context: UploadContext,
  options: BodyOptions,
): Promise<{ body: Blob | FormData; contentType: string | undefined }> {
  if (options.body === "raw") {
    return { body: file, contentType: file.type || "application/octet-stream" };
  }
  const form = new FormData();
  const fields = await resolvePerAttempt(options.fields, file, context);
  for (const [key, value] of Object.entries(fields ?? {})) form.append(key, value);
  form.append(options.fieldName ?? "file", file, file.name);
  // The browser sets the multipart boundary itself.
  return { body: form, contentType: undefined };
}

export function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** Parses a response body as JSON when it looks like JSON, otherwise returns text. */
export function parseBody(text: string, contentType: string | null | undefined): unknown {
  if (!text) return null;
  if (contentType?.includes("json") || /^[[{]/.test(text.trim())) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

export function parseRawHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const idx = line.indexOf(":");
    if (idx > 0) out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return out;
}

export const MAX_ERROR_BODY = 64 * 1024;
