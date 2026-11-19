import type { UploadContext, UploadFunction } from "@uploadrescue/core";
import { xhrRequest } from "./xhr";

export interface S3UploadTarget {
  /** Presigned URL (PUT) or bucket URL (POST policy). */
  url: string;
  /** Default `PUT`. Use `POST` for presigned POST policies. */
  method?: "PUT" | "POST";
  /** Form fields returned by `createPresignedPost` (POST only). */
  fields?: Record<string, string>;
  /** Extra headers that were signed into a PUT URL. */
  headers?: Record<string, string>;
  /** Object key, echoed in the result. */
  key?: string;
}

export interface S3UploadOptions {
  /**
   * Called for every attempt — including retries with the optimized file — so
   * you can sign a URL for the new size and content type.
   */
  getTarget: (file: File, context: UploadContext) => Promise<S3UploadTarget>;
  /** Send the Content-Type header on PUT (must match what was signed). Default true. */
  sendContentType?: boolean;
}

export interface S3UploadResult {
  key: string | undefined;
  url: string;
  etag: string | undefined;
  status: number;
}

/**
 * Upload to S3 (or S3-compatible storage such as R2 or MinIO) with a presigned
 * PUT URL or POST policy. Oversize rejections (`EntityTooLarge`, returned as
 * HTTP 400) are classified as size failures automatically.
 */
export function createS3PresignedUpload(options: S3UploadOptions): UploadFunction<S3UploadResult> {
  return async (file, context) => {
    const target = await options.getTarget(file, context);
    const method = target.method ?? "PUT";
    let response;
    if (method === "POST") {
      const form = new FormData();
      for (const [k, v] of Object.entries(target.fields ?? {})) form.append(k, v);
      // S3 requires the file to be the last field.
      form.append("file", file, file.name);
      response = await xhrRequest({ url: target.url, method, body: form }, context);
    } else {
      const headers: Record<string, string> = { ...(target.headers ?? {}) };
      if (options.sendContentType !== false && file.type && !("content-type" in lower(headers))) {
        headers["content-type"] = file.type;
      }
      response = await xhrRequest({ url: target.url, method, body: file, headers }, context);
    }
    return {
      key: target.key ?? target.fields?.key,
      url: target.url.split("?")[0] ?? target.url,
      etag: response.headers.etag,
      status: response.status,
    };
  };
}

function lower(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}
