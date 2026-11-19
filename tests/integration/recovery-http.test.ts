/**
 * End-to-end recovery against a real HTTP server, using the real fetch
 * adapter and real (Node-compatible) optimization engines.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUploadRescue, type UploadFailure } from "@uploadrescue/core";
import { createArchiveEngine } from "@uploadrescue/archive-engine";
import { createFetchUpload } from "@uploadrescue/upload-adapters";

interface Received {
  path: string;
  size: number;
  idempotencyKey: string | undefined;
  aborted: boolean;
}

let server: Server;
let base = "";
let received: Received[] = [];
let flakyFailures = 0;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Extracts the uploaded file size from a multipart body (good enough for tests). */
function filePartSize(body: Buffer, contentType: string): number {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) return body.length;
  const marker = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = body.indexOf(marker);
  while (start !== -1) {
    const next = body.indexOf(marker, start + marker.length);
    if (next === -1) break;
    parts.push(body.subarray(start + marker.length, next));
    start = next;
  }
  const file = parts.find((p) => p.includes('filename="'));
  if (!file) return 0;
  const headerEnd = file.indexOf("\r\n\r\n");
  return file.length - headerEnd - 4 - 2; // minus trailing CRLF
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, "http://localhost");
  const entry: Received = {
    path: url.pathname,
    size: 0,
    idempotencyKey: req.headers["idempotency-key"] as string,
    aborted: false,
  };
  received.push(entry);
  req.on("aborted", () => (entry.aborted = true));
  res.on("close", () => {
    if (!res.writableFinished) entry.aborted = true;
  });

  if (url.pathname === "/slow") return; // never responds
  if (url.pathname === "/flaky" && flakyFailures > 0) {
    flakyFailures -= 1;
    req.socket.destroy(); // connection reset → network error
    return;
  }
  const body = await readBody(req);
  entry.size = filePartSize(body, req.headers["content-type"] ?? "");
  const limit = Number(url.searchParams.get("limit") ?? Infinity);
  const json = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(payload));
  };

  if (url.pathname === "/auth") return json(401, { error: "unauthorized" });
  if (url.pathname === "/app-error" && entry.size > limit)
    return json(422, { code: "UPLOAD_QUOTA_FILE_TOO_BIG" });
  if (url.pathname === "/announce" && entry.size > limit) {
    return json(413, { error: "too large" }, { "x-upload-max-size": String(limit) });
  }
  if (entry.size > limit) return json(413, { error: "Payload Too Large" });
  json(201, { id: `file-${received.length}`, size: entry.size });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    handle(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  received = [];
  flakyFailures = 0;
});

/** A stored (uncompressed) ZIP of highly compressible text: the archive engine can shrink it a lot. */
function compressibleZip(kb = 64) {
  const text = strToU8("UploadRescue integration test payload. ".repeat((kb * 1024) / 38));
  return new File(
    [
      zipSync(
        { "data.txt": text, "notes/readme.md": strToU8("# Notes\n".repeat(200)) },
        { level: 0 },
      ),
    ],
    "export.zip",
    {
      type: "application/zip",
    },
  );
}

describe("recovery over real HTTP", () => {
  it("uploads successfully when the file is within limits", async () => {
    const rescue = createUploadRescue({
      upload: createFetchUpload({ url: `${base}/upload?limit=1000000` }),
    });
    const state = await rescue.select(compressibleZip(8));
    expect(state.status).toBe("success");
    expect(state.result).toMatchObject({ id: "file-1" });
  });

  it("recovers from a real HTTP 413 by optimizing and retrying the same upload function", async () => {
    const file = compressibleZip(64);
    const original = new Uint8Array(await file.arrayBuffer());
    const rescue = createUploadRescue({
      upload: createFetchUpload({
        url: `${base}/upload?limit=20000`,
        idempotencyHeader: "Idempotency-Key",
      }),
      engines: [createArchiveEngine()],
    });
    let state = await rescue.select(file);
    expect(state.status).toBe("recovery-available");
    expect(state.failure).toMatchObject({ kind: "file-too-large", status: 413, source: "http" });

    state = await rescue.recover();
    expect(state.status).toBe("success");
    expect(received).toHaveLength(2);
    expect(received[0]!.size).toBe(file.size);
    expect(received[1]!.size).toBeLessThan(20000);
    expect(received[0]!.idempotencyKey).toBe(received[1]!.idempotencyKey);
    // The uploaded optimized archive is valid and has identical contents.
    const optimized = new Uint8Array(await state.activeFile!.arrayBuffer());
    expect(unzipSync(optimized)).toEqual(unzipSync(original));
    // The original File is untouched.
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(original);
  });

  it("learns the server limit from X-Upload-Max-Size", async () => {
    const rescue = createUploadRescue({
      upload: createFetchUpload({ url: `${base}/announce?limit=30000` }),
      engines: [createArchiveEngine()],
      recovery: { autoRetry: true },
    });
    const state = await rescue.select(compressibleZip(64));
    expect(state.maxSize).toBe(30000);
    expect(state.status).toBe("success");
  });

  it("recovers from an application-specific JSON error via classifyError", async () => {
    const rescue = createUploadRescue({
      upload: createFetchUpload({ url: `${base}/app-error?limit=20000` }),
      engines: [createArchiveEngine()],
      classifyError: (error): UploadFailure | null => {
        const body = (error as { body?: string }).body ?? "";
        return body.includes("UPLOAD_QUOTA_FILE_TOO_BIG")
          ? {
              kind: "file-too-large",
              source: "custom",
              message: "Over quota",
              retryable: false,
              optimizable: true,
            }
          : null;
      },
    });
    await rescue.select(compressibleZip(64));
    expect(rescue.getState().recoveryAction).toBe("optimize");
    expect((await rescue.recover()).status).toBe("success");
  });

  it("produces a useful failure when the retry is also rejected", async () => {
    const rescue = createUploadRescue({
      upload: createFetchUpload({ url: `${base}/upload?limit=100` }),
      engines: [createArchiveEngine()],
      recovery: { autoRetry: true, maxAttempts: 2 },
      optimization: { maxAttempts: 2 },
    });
    const state = await rescue.select(compressibleZip(64));
    expect(["failed", "optimization-failed"]).toContain(state.status);
    if (state.status === "failed") expect(state.failure?.kind).toBe("file-too-large");
    else expect(state.optimizationFailure?.reason).toBe("no-reduction");
    expect(received.length).toBeLessThanOrEqual(3);
  });

  it("fails without retrying when optimization is unavailable for the type", async () => {
    const rescue = createUploadRescue({
      upload: createFetchUpload({ url: `${base}/upload?limit=10` }),
      engines: [createArchiveEngine()],
    });
    const state = await rescue.select(
      new File(["x".repeat(500)], "notes.txt", { type: "text/plain" }),
    );
    expect(state.status).toBe("failed");
    expect(received).toHaveLength(1);
  });

  it("never retries authentication failures", async () => {
    const rescue = createUploadRescue({
      upload: createFetchUpload({ url: `${base}/auth` }),
      engines: [createArchiveEngine()],
      recovery: { autoRetry: true },
    });
    const state = await rescue.select(compressibleZip(8));
    expect(state).toMatchObject({ status: "failed", failure: { kind: "auth", status: 401 } });
    expect(received).toHaveLength(1);
  });

  it("retries after a real connection reset", async () => {
    flakyFailures = 1;
    const rescue = createUploadRescue({ upload: createFetchUpload({ url: `${base}/flaky` }) });
    let state = await rescue.select(compressibleZip(8));
    expect(state.failure?.kind).toBe("network");
    expect(state.recoveryAction).toBe("retry");
    state = await rescue.recover();
    expect(state.status).toBe("success");
  });

  it("times out and cancels the in-flight request", async () => {
    const rescue = createUploadRescue({
      upload: createFetchUpload({ url: `${base}/slow` }),
      timeout: 300,
      recovery: { enabled: false },
    });
    const state = await rescue.select(compressibleZip(8));
    expect(state.failure?.kind).toBe("timeout");
    await expect.poll(() => received[0]?.aborted).toBe(true);
  });

  it("cancellation aborts the real request and keeps the original file", async () => {
    const rescue = createUploadRescue({ upload: createFetchUpload({ url: `${base}/slow` }) });
    const file = compressibleZip(8);
    const run = rescue.select(file);
    await expect.poll(() => received.length).toBe(1);
    rescue.cancel();
    const state = await run;
    expect(state.status).toBe("cancelled");
    expect(state.originalFile).toBe(file);
    await expect.poll(() => received[0]!.aborted).toBe(true);
  });
});
