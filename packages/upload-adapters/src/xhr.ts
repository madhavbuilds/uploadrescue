import {
  UploadAbortedError,
  UploadHttpError,
  UploadNetworkError,
  type UploadContext,
  type UploadFunction,
} from "@uploadrescue/core";
import { requestHeaders, type HttpUploadOptions } from "./fetch";
import { MAX_ERROR_BODY, buildBody, parseBody, parseRawHeaders, resolvePerAttempt } from "./shared";

export interface XhrResponse {
  status: number;
  body: unknown;
  text: string;
  headers: Record<string, string>;
}

export interface XhrRequestInit {
  url: string;
  method: string;
  body: Blob | FormData;
  headers?: Record<string, string>;
  withCredentials?: boolean;
}

/**
 * Sends one request with XMLHttpRequest, reporting upload progress and
 * honouring the context's AbortSignal. Rejects with typed UploadRescue errors.
 */
export function xhrRequest(
  init: XhrRequestInit,
  context: Pick<UploadContext, "signal" | "reportProgress">,
): Promise<XhrResponse> {
  return new Promise((resolve, reject) => {
    if (context.signal.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(init.method, init.url, true);
    xhr.withCredentials = init.withCredentials ?? false;
    for (const [key, value] of Object.entries(init.headers ?? {})) xhr.setRequestHeader(key, value);

    const onAbort = () => xhr.abort();
    context.signal.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => context.signal.removeEventListener("abort", onAbort);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) context.reportProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      cleanup();
      const headers = parseRawHeaders(xhr.getAllResponseHeaders());
      const text = typeof xhr.responseText === "string" ? xhr.responseText : "";
      if (xhr.status === 0) {
        reject(new UploadNetworkError());
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new UploadHttpError({
            status: xhr.status,
            statusText: xhr.statusText,
            body: text.slice(0, MAX_ERROR_BODY),
            headers,
            url: init.url,
          }),
        );
        return;
      }
      resolve({
        status: xhr.status,
        text,
        headers,
        body: parseBody(text, headers["content-type"]),
      });
    };
    xhr.onerror = () => {
      cleanup();
      reject(new UploadNetworkError());
    };
    xhr.onabort = () => {
      cleanup();
      reject(
        context.signal.reason instanceof Error ? context.signal.reason : new UploadAbortedError(),
      );
    };
    xhr.send(init.body);
  });
}

export interface XhrUploadOptions<TResult> extends HttpUploadOptions<TResult> {
  withCredentials?: boolean;
}

/** Like {@link createFetchUpload} but uses XMLHttpRequest to report upload progress. */
export function createXhrUpload<TResult = unknown>(
  options: XhrUploadOptions<TResult>,
): UploadFunction<TResult> {
  return async (file, context) => {
    const url = await resolvePerAttempt(options.url, file, context);
    if (!url) throw new TypeError("createXhrUpload: `url` resolved to an empty value.");
    const { body, contentType } = await buildBody(file, context, options);
    const headers = await requestHeaders(options, file, context, contentType);
    const response = await xhrRequest(
      {
        url,
        method: options.method ?? "POST",
        body,
        headers,
        ...(options.withCredentials !== undefined
          ? { withCredentials: options.withCredentials }
          : {}),
      },
      context,
    );
    return options.parseResult
      ? options.parseResult(response.body, { status: response.status, headers: response.headers })
      : (response.body as TResult);
  };
}

/** Generic multipart/form-data upload with progress. */
export function createMultipartUpload<TResult = unknown>(
  options: Omit<XhrUploadOptions<TResult>, "body">,
): UploadFunction<TResult> {
  return createXhrUpload({ ...options, body: "multipart" });
}
