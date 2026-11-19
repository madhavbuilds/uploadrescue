import { describe, expect, it } from "vitest";
import {
  UploadAbortedError,
  UploadHttpError,
  UploadNetworkError,
  UploadTimeoutError,
  classifyUploadError,
} from "../src";

const http = (status: number, body?: string, headers?: Record<string, string>) =>
  new UploadHttpError({ status, ...(body ? { body } : {}), ...(headers ? { headers } : {}) });

describe("classifyUploadError", () => {
  it("classifies HTTP 413 as an optimizable size failure", () => {
    const f = classifyUploadError(http(413));
    expect(f).toMatchObject({
      kind: "file-too-large",
      status: 413,
      optimizable: true,
      retryable: false,
    });
  });

  it("reads server-announced limits from headers and JSON bodies", () => {
    expect(
      classifyUploadError(http(413, undefined, { "x-upload-max-size": "1048576" })).serverMaxSize,
    ).toBe(1048576);
    expect(classifyUploadError(http(413, JSON.stringify({ maxSize: 2048 }))).serverMaxSize).toBe(
      2048,
    );
    expect(classifyUploadError(http(413, "not json")).serverMaxSize).toBeUndefined();
  });

  it("recognises storage-provider size errors returned with HTTP 400", () => {
    const s3 = http(400, "<Error><Code>EntityTooLarge</Code></Error>");
    const supabase = http(
      400,
      '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}',
    );
    const cloudinary = http(
      400,
      '{"error":{"message":"File size too large. Got 12000000. Maximum is 10485760."}}',
    );
    for (const err of [s3, supabase, cloudinary])
      expect(classifyUploadError(err).kind).toBe("file-too-large");
  });

  it("honours configured size statuses", () => {
    expect(classifyUploadError(http(422)).kind).toBe("unknown");
    expect(classifyUploadError(http(422), { sizeErrorStatuses: [422] }).kind).toBe(
      "file-too-large",
    );
  });

  it("never marks auth, type, rate-limit or server errors as retryable", () => {
    for (const [status, kind] of [
      [401, "auth"],
      [403, "auth"],
      [415, "unsupported-type"],
      [429, "rate-limited"],
      [500, "server"],
      [503, "server"],
    ] as const) {
      const f = classifyUploadError(http(status));
      expect(f.kind).toBe(kind);
      expect(f.retryable).toBe(false);
      expect(f.optimizable).toBe(false);
    }
  });

  it("does not treat size wording in 5xx bodies as a size error", () => {
    expect(classifyUploadError(http(500, "payload too large")).kind).toBe("server");
  });

  it("classifies network, timeout and abort errors", () => {
    expect(classifyUploadError(new TypeError("Failed to fetch"))).toMatchObject({
      kind: "network",
      retryable: true,
    });
    expect(classifyUploadError(new UploadNetworkError()).kind).toBe("network");
    expect(classifyUploadError(new UploadTimeoutError(5000))).toMatchObject({
      kind: "timeout",
      retryable: true,
    });
    expect(classifyUploadError(http(408)).kind).toBe("timeout");
    expect(classifyUploadError(new UploadAbortedError()).kind).toBe("cancelled");
    expect(classifyUploadError(new DOMException("x", "AbortError")).kind).toBe("cancelled");
  });

  it("treats unknown errors conservatively", () => {
    expect(classifyUploadError(new Error("boom"))).toMatchObject({
      kind: "unknown",
      retryable: false,
      optimizable: false,
    });
    expect(classifyUploadError("string").kind).toBe("unknown");
  });
});
