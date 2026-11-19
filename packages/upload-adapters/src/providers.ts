import {
  UploadAbortedError,
  UploadHttpError,
  UploadNetworkError,
  type UploadContext,
  type UploadFunction,
} from "@uploadrescue/core";
import { xhrRequest } from "./xhr";

// ---------------------------------------------------------------- Supabase

/** The subset of `supabase.storage` used by the adapter (no dependency on supabase-js). */
export interface SupabaseStorageLike {
  from(bucket: string): {
    upload(
      path: string,
      file: File,
      options?: { upsert?: boolean; contentType?: string; cacheControl?: string },
    ): Promise<{ data: unknown; error: unknown }>;
  };
}

export interface SupabaseUploadOptions {
  /** `supabase.storage` from your client. */
  storage: SupabaseStorageLike;
  bucket: string;
  /** Object path per attempt, e.g. `(file) => \`avatars/${userId}/${file.name}\``. */
  path: (file: File, context: UploadContext) => string;
  upsert?: boolean;
  cacheControl?: string;
}

/**
 * Supabase Storage adapter. supabase-js does not accept an AbortSignal, so
 * cancellation stops UploadRescue from waiting but the request may complete
 * in the background.
 */
export function createSupabaseUpload(options: SupabaseUploadOptions): UploadFunction<unknown> {
  return async (file, context) => {
    const { data, error } = await options.storage
      .from(options.bucket)
      .upload(options.path(file, context), file, {
        upsert: options.upsert ?? false,
        ...(file.type ? { contentType: file.type } : {}),
        ...(options.cacheControl ? { cacheControl: options.cacheControl } : {}),
      });
    if (error) throw normalizeSupabaseError(error);
    return data;
  };
}

export function normalizeSupabaseError(error: unknown): Error {
  const e = (error ?? {}) as {
    name?: string;
    message?: string;
    status?: unknown;
    statusCode?: unknown;
    error?: unknown;
  };
  const status = Number(e.statusCode ?? e.status);
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return new UploadHttpError({
      status,
      body: JSON.stringify({ error: e.error, message: e.message }),
      cause: error,
    });
  }
  if (e.name === "StorageUnknownError") return new UploadNetworkError(e.message, { cause: error });
  return error instanceof Error
    ? error
    : new Error(e.message ?? "Supabase upload failed", { cause: error });
}

// ---------------------------------------------------------------- Firebase

export interface FirebaseUploadSnapshotLike {
  bytesTransferred: number;
  totalBytes: number;
}

export interface FirebaseUploadTaskLike {
  on(
    event: "state_changed",
    next: (snapshot: FirebaseUploadSnapshotLike) => void,
    error: (error: { code?: string; message?: string }) => void,
    complete: () => void,
  ): unknown;
  cancel(): boolean;
  snapshot: { ref: unknown; metadata?: unknown };
}

export interface FirebaseUploadOptions<TRef> {
  /** `uploadBytesResumable` from `firebase/storage`. */
  uploadBytesResumable: (
    ref: TRef,
    data: Blob,
    metadata?: { contentType?: string },
  ) => FirebaseUploadTaskLike;
  /** Storage reference per attempt, e.g. `(file) => ref(storage, \`uploads/${file.name}\`)`. */
  getRef: (file: File, context: UploadContext) => TRef;
}

export interface FirebaseUploadResult {
  ref: unknown;
  metadata: unknown;
}

/**
 * Firebase Storage adapter with progress and real cancellation.
 * Note: size limits enforced by Security Rules surface as `storage/unauthorized`,
 * which is indistinguishable from a permission error — set `maxSize` client-side.
 */
export function createFirebaseUpload<TRef>(
  options: FirebaseUploadOptions<TRef>,
): UploadFunction<FirebaseUploadResult> {
  return (file, context) =>
    new Promise((resolve, reject) => {
      const task = options.uploadBytesResumable(options.getRef(file, context), file, {
        ...(file.type ? { contentType: file.type } : {}),
      });
      const onAbort = () => task.cancel();
      context.signal.addEventListener("abort", onAbort, { once: true });
      task.on(
        "state_changed",
        (snap) => context.reportProgress(snap.bytesTransferred, snap.totalBytes),
        (error) => {
          context.signal.removeEventListener("abort", onAbort);
          reject(normalizeFirebaseError(error));
        },
        () => {
          context.signal.removeEventListener("abort", onAbort);
          resolve({ ref: task.snapshot.ref, metadata: task.snapshot.metadata });
        },
      );
    });
}

export function normalizeFirebaseError(error: { code?: string; message?: string }): Error {
  const body = JSON.stringify({ code: error.code, message: error.message });
  switch (error.code) {
    case "storage/canceled":
      return new UploadAbortedError();
    case "storage/unauthenticated":
      return new UploadHttpError({ status: 401, body, cause: error });
    case "storage/unauthorized":
      return new UploadHttpError({ status: 403, body, cause: error });
    case "storage/retry-limit-exceeded":
      return new UploadNetworkError(error.message, { cause: error });
    case "storage/quota-exceeded":
      return new UploadHttpError({ status: 507, body, cause: error });
    default:
      return new Error(error.message ?? "Firebase upload failed", { cause: error });
  }
}

// ---------------------------------------------------------------- Cloudinary

export interface CloudinarySignature {
  signature: string;
  timestamp: number | string;
  apiKey: string;
  /** Any other parameters you signed (folder, public_id, ...). */
  params?: Record<string, string>;
}

export interface CloudinaryUploadOptions {
  cloudName: string;
  /** `image`, `video`, `raw` or `auto` (default). */
  resourceType?: "image" | "video" | "raw" | "auto";
  /** Unsigned uploads: an unsigned upload preset. */
  uploadPreset?: string;
  /** Signed uploads: fetch a signature from your server for every attempt. */
  getSignature?: (file: File, context: UploadContext) => Promise<CloudinarySignature>;
  folder?: string;
}

/** Cloudinary upload API adapter with progress. "File size too large" errors are classified as size failures. */
export function createCloudinaryUpload(options: CloudinaryUploadOptions): UploadFunction<unknown> {
  if (!options.uploadPreset && !options.getSignature) {
    throw new TypeError(
      "createCloudinaryUpload: provide `uploadPreset` (unsigned) or `getSignature` (signed).",
    );
  }
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(options.cloudName)}/${options.resourceType ?? "auto"}/upload`;
  return async (file, context) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (options.folder) form.append("folder", options.folder);
    if (options.uploadPreset) form.append("upload_preset", options.uploadPreset);
    if (options.getSignature) {
      const sig = await options.getSignature(file, context);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature);
      for (const [k, v] of Object.entries(sig.params ?? {})) form.set(k, v);
    }
    const response = await xhrRequest({ url, method: "POST", body: form }, context);
    return response.body;
  };
}
