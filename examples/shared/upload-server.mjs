// A tiny real upload endpoint used by the example apps' dev servers.
// It enforces a size limit with HTTP 413 (announcing the limit in the JSON
// body) and discards everything it receives — nothing is stored.

const HARD_CAP = 64 * 1024 * 1024;

/** Size of the first file part in a multipart body, or the body size for raw uploads. */
export function uploadedFileSize(body, contentType = "") {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) return body.length;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(marker);
  while (start !== -1) {
    const next = body.indexOf(marker, start + marker.length);
    if (next === -1) break;
    const part = body.subarray(start + marker.length, next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1 && part.subarray(0, headerEnd).includes("filename=")) {
      return part.length - headerEnd - 4 - 2;
    }
    start = next;
  }
  return 0;
}

/** Connect/Vite middleware for POST /api/upload. */
export function uploadMiddleware({ limit = Number(process.env.UPLOAD_LIMIT ?? 1024 * 1024) } = {}) {
  return (req, res, next) => {
    if (req.url?.split("?")[0] !== "/api/upload") return next();
    if (req.method !== "POST" && req.method !== "PUT") {
      res.statusCode = 405;
      return res.end();
    }
    const chunks = [];
    let received = 0;
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received <= HARD_CAP) chunks.push(chunk);
    });
    req.on("end", () => {
      const send = (status, payload) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(payload));
      };
      if (received > HARD_CAP) return send(413, { error: "Payload Too Large", maxSize: limit });
      const size = uploadedFileSize(Buffer.concat(chunks), req.headers["content-type"]);
      console.log(`[upload] ${size} bytes → ${size > limit ? 413 : 201}`);
      if (size > limit) return send(413, { error: "Payload Too Large", maxSize: limit });
      send(201, { ok: true, size, storedAt: null, note: "Example server: files are discarded." });
    });
  };
}

/** Vite plugin wrapper. */
export function uploadServerPlugin(options) {
  return {
    name: "uploadrescue-example-upload-server",
    configureServer(server) {
      server.middlewares.use(uploadMiddleware(options));
    },
    configurePreviewServer(server) {
      server.middlewares.use(uploadMiddleware(options));
    },
  };
}
