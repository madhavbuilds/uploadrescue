import {
  UploadHttpError,
  UploadNetworkError,
  isAbortError,
  type UploadContext,
  type UploadFunction,
} from "@uploadrescue/core";
import {
  buildBody,
  headersToRecord,
  parseBody,
  resolvePerAttempt,
  type BodyOptions,
  type PerAttempt,
} from "./shared";

export interface HttpUploadOptions<TResult> extends BodyOptions {
  /** Endpoint; may be computed per attempt (e.g. a fresh signed URL). */
  url: PerAttempt<string>;
  method?: "POST" | "PUT" | "PATCH";
  headers?: PerAttempt<HeadersInit>;
  /**
   * Header used to send `context.idempotencyKey`, e.g. `"Idempotency-Key"`.
   * Off by default because custom headers trigger CORS preflights.
   */
  idempotencyHeader?: string;
  /** Map the successful response body to your result type. */
  parseResult?: (
    body: unknown,
    info: { status: number; headers: Record<string, string> },
  ) => TResult;
}

export interface FetchUploadOptions<TResult> extends HttpUploadOptions<TResult> {
  credentials?: RequestCredentials;
  /** Custom fetch implementation (tests, polyfills). */
  fetch?: typeof fetch;
}

export async function requestHeaders(
  options: HttpUploadOptions<unknown>,
  file: File,
  context: UploadContext,
  contentType: string | undefined,
): Promise<Record<string, string>> {
  const headers = headersToRecord(await resolvePerAttempt(options.headers, file, context));
  if (contentType && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
    headers["content-type"] = contentType;
  }
  if (options.idempotencyHeader) headers[options.idempotencyHeader] = context.idempotencyKey;
  return headers;
}

/**
 * Upload with `fetch`. Non-2xx responses throw `UploadHttpError` (status,
 * headers and up to 64 KB of body) so the classifier can recognise 413s and
 * provider-specific size errors. `fetch` has no upload progress; use
 * {@link createXhrUpload} when you need it.
 */
export function createFetchUpload<TResult = unknown>(
  options: FetchUploadOptions<TResult>,
): UploadFunction<TResult> {
  return async (file, context) => {
    const url = await resolvePerAttempt(options.url, file, context);
    if (!url) throw new TypeError("createFetchUpload: `url` resolved to an empty value.");
    const { body, contentType } = await buildBody(file, context, options);
    const headers = await requestHeaders(options, file, context, contentType);
    const doFetch = options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: options.method ?? "POST",
        body,
        headers,
        signal: context.signal,
        ...(options.credentials ? { credentials: options.credentials } : {}),
      });
    } catch (error) {
      if (isAbortError(error) || context.signal.aborted) throw error;
      throw new UploadNetworkError(undefined, { cause: error });
    }
    if (!response.ok) throw await UploadHttpError.fromResponse(response);
    const text = await response.text();
    const parsed = parseBody(text, response.headers.get("content-type"));
    const info = { status: response.status, headers: headersToRecord(response.headers) };
    return options.parseResult ? options.parseResult(parsed, info) : (parsed as TResult);
  };
}
