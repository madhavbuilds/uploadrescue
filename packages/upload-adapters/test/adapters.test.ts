import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UploadHttpError,
  classifyUploadError,
  createUploadRescue,
  type UploadContext,
} from "@uploadrescue/core";
import {
  createCloudinaryUpload,
  createFirebaseUpload,
  createS3PresignedUpload,
  createSupabaseUpload,
  createXhrUpload,
  type FirebaseUploadTaskLike,
} from "../src";

function ctx(over: Partial<UploadContext> = {}): UploadContext {
  return {
    attempt: 1,
    isRetry: false,
    originalFile: new File(["x"], "x.txt"),
    optimization: null,
    signal: new AbortController().signal,
    idempotencyKey: "key-1",
    attemptId: "attempt-1",
    previousFailure: null,
    reportProgress: vi.fn(),
    ...over,
  };
}

// ------------------------------------------------------------- fake XHR

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}
let sent: Sent[] = [];
let respond: (xhr: FakeXhr) => void = () => undefined;

class FakeXhr {
  status = 0;
  statusText = "";
  responseText = "";
  withCredentials = false;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private req: Sent = { method: "", url: "", headers: {}, body: null };
  private responseHeaders = "";
  open(method: string, url: string) {
    this.req.method = method;
    this.req.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.req.headers[k.toLowerCase()] = v;
  }
  getAllResponseHeaders() {
    return this.responseHeaders;
  }
  send(body: unknown) {
    this.req.body = body;
    sent.push(this.req);
    queueMicrotask(() => respond(this));
  }
  abort() {
    this.onabort?.();
  }
  reply(status: number, text: string, headers = "content-type: application/json") {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    this.status = status;
    this.responseText = text;
    this.responseHeaders = headers;
    this.onload?.();
  }
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});
afterEach(() => vi.unstubAllGlobals());

const file = new File([new Uint8Array(100)], "photo.jpg", { type: "image/jpeg" });

describe("createXhrUpload", () => {
  it("sends multipart with extra fields and reports progress", async () => {
    respond = (x) => x.reply(200, '{"id":42}');
    const context = ctx();
    const upload = createXhrUpload<{ id: number }>({
      url: "/upload",
      fields: { folder: "a" },
      idempotencyHeader: "Idempotency-Key",
    });
    await expect(upload(file, context)).resolves.toEqual({ id: 42 });
    const form = sent[0]!.body as FormData;
    expect(form.get("folder")).toBe("a");
    expect((form.get("file") as File).name).toBe("photo.jpg");
    expect(sent[0]!.headers["idempotency-key"]).toBe("key-1");
    expect(context.reportProgress).toHaveBeenCalledWith(50, 100);
  });

  it("throws a classifiable UploadHttpError for 413", async () => {
    respond = (x) => x.reply(413, '{"maxSize":2048}');
    const error = await createXhrUpload({ url: "/upload" })(file, ctx()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadHttpError);
    expect(classifyUploadError(error)).toMatchObject({
      kind: "file-too-large",
      serverMaxSize: 2048,
    });
  });

  it("maps network errors and aborts", async () => {
    respond = (x) => x.onerror?.();
    expect(
      classifyUploadError(
        await createXhrUpload({ url: "/u" })(file, ctx()).catch((e: unknown) => e),
      ).kind,
    ).toBe("network");
    const controller = new AbortController();
    respond = () => controller.abort();
    const aborted = await createXhrUpload({ url: "/u" })(
      file,
      ctx({ signal: controller.signal }),
    ).catch((e: unknown) => e);
    expect(classifyUploadError(aborted).kind).toBe("cancelled");
  });

  it("computes the URL per attempt", async () => {
    respond = (x) => x.reply(200, "ok", "content-type: text/plain");
    const url = vi.fn((_f: File, c: UploadContext) => `/signed?attempt=${c.attempt}`);
    await createXhrUpload({ url, body: "raw", method: "PUT" })(file, ctx({ attempt: 2 }));
    expect(sent[0]).toMatchObject({ url: "/signed?attempt=2", method: "PUT", body: file });
    expect(sent[0]!.headers["content-type"]).toBe("image/jpeg");
  });
});

describe("createS3PresignedUpload", () => {
  it("requests a fresh target for every attempt and classifies EntityTooLarge", async () => {
    const getTarget = vi.fn(async (_f: File, c: UploadContext) => ({
      url: `https://bucket.s3/key?sig=${c.attemptId}`,
      key: "key",
    }));
    let calls = 0;
    respond = (x) => {
      calls += 1;
      if (calls === 1)
        x.reply(400, "<Error><Code>EntityTooLarge</Code></Error>", "content-type: application/xml");
      else x.reply(200, "", 'etag: "abc"');
    };
    const rescue = createUploadRescue({
      upload: createS3PresignedUpload({ getTarget }),
      engines: [
        {
          id: "shrink",
          supportedTypes: ["*"],
          canProcess: () => true,
          optimize: async (f) => ({ blob: f.slice(0, 50), type: "image/jpeg" }),
        },
      ],
      recovery: { autoRetry: true },
    });
    const jpeg = new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(96).fill(1)])],
      "a.jpg",
      { type: "image/jpeg" },
    );
    const state = await rescue.select(jpeg);
    expect(state.status).toBe("success");
    expect(state.result).toMatchObject({ key: "key", url: "https://bucket.s3/key", etag: '"abc"' });
    expect(getTarget).toHaveBeenCalledTimes(2);
    expect(sent[0]!.url).not.toBe(sent[1]!.url);
    expect((sent[1]!.body as File).size).toBe(50);
  });

  it("puts form fields before the file for POST policies", async () => {
    respond = (x) => x.reply(204, "");
    await createS3PresignedUpload({
      getTarget: async () => ({
        url: "https://bucket.s3",
        method: "POST",
        fields: { key: "k", policy: "p" },
      }),
    })(file, ctx());
    const keys = [...(sent[0]!.body as FormData).keys()];
    expect(keys).toEqual(["key", "policy", "file"]);
  });
});

describe("createSupabaseUpload", () => {
  it("normalizes storage errors so size failures are recognised", async () => {
    const upload = vi.fn(async () => ({
      data: null,
      error: {
        name: "StorageApiError",
        status: 400,
        statusCode: "413",
        message: "The object exceeded the maximum allowed size",
      },
    }));
    const storage = { from: () => ({ upload }) };
    const fn = createSupabaseUpload({ storage, bucket: "b", path: (f) => `u/${f.name}` });
    const error = await fn(file, ctx()).catch((e: unknown) => e);
    expect(classifyUploadError(error).kind).toBe("file-too-large");
    expect(upload).toHaveBeenCalledWith(
      "u/photo.jpg",
      file,
      expect.objectContaining({ contentType: "image/jpeg", upsert: false }),
    );
  });
});

describe("createFirebaseUpload", () => {
  function task(
    behaviour: "ok" | "unauthorized" | "hang",
  ): FirebaseUploadTaskLike & { cancelled: boolean } {
    let error: ((e: { code?: string }) => void) | undefined;
    const t = {
      cancelled: false,
      snapshot: { ref: "ref", metadata: { size: 1 } },
      cancel() {
        t.cancelled = true;
        error?.({ code: "storage/canceled" });
        return true;
      },
      on(
        _e: string,
        next: (s: { bytesTransferred: number; totalBytes: number }) => void,
        err: (e: { code?: string }) => void,
        done: () => void,
      ) {
        error = err;
        next({ bytesTransferred: 10, totalBytes: 20 });
        if (behaviour === "ok") queueMicrotask(done);
        if (behaviour === "unauthorized")
          queueMicrotask(() => err({ code: "storage/unauthorized" }));
      },
    };
    return t;
  }

  it("reports progress and resolves", async () => {
    const context = ctx();
    const fn = createFirebaseUpload({
      uploadBytesResumable: () => task("ok"),
      getRef: () => "ref",
    });
    await expect(fn(file, context)).resolves.toEqual({ ref: "ref", metadata: { size: 1 } });
    expect(context.reportProgress).toHaveBeenCalledWith(10, 20);
  });

  it("maps permission errors (never retried) and cancels the task on abort", async () => {
    const fn = createFirebaseUpload({
      uploadBytesResumable: () => task("unauthorized"),
      getRef: () => "ref",
    });
    expect(classifyUploadError(await fn(file, ctx()).catch((e: unknown) => e)).kind).toBe("auth");
    const hanging = task("hang");
    const controller = new AbortController();
    const run = createFirebaseUpload({ uploadBytesResumable: () => hanging, getRef: () => "ref" })(
      file,
      ctx({ signal: controller.signal }),
    );
    controller.abort();
    expect(classifyUploadError(await run.catch((e: unknown) => e)).kind).toBe("cancelled");
    expect(hanging.cancelled).toBe(true);
  });
});

describe("createCloudinaryUpload", () => {
  it("requires a preset or a signature provider", () => {
    expect(() => createCloudinaryUpload({ cloudName: "demo" })).toThrow(/uploadPreset/);
  });

  it("sends signed parameters fetched per attempt", async () => {
    respond = (x) => x.reply(200, '{"secure_url":"https://res.cloudinary.com/x"}');
    const fn = createCloudinaryUpload({
      cloudName: "demo",
      getSignature: async () => ({ signature: "sig", timestamp: 123, apiKey: "key" }),
    });
    await expect(fn(file, ctx())).resolves.toEqual({ secure_url: "https://res.cloudinary.com/x" });
    expect(sent[0]!.url).toBe("https://api.cloudinary.com/v1_1/demo/auto/upload");
    const form = sent[0]!.body as FormData;
    expect([form.get("signature"), form.get("timestamp"), form.get("api_key")]).toEqual([
      "sig",
      "123",
      "key",
    ]);
  });
});
