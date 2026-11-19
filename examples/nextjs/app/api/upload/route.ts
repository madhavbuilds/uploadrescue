const LIMIT = 1024 * 1024; // 1 MB

/**
 * Example endpoint: enforces a size limit with HTTP 413 and reports the limit,
 * which UploadRescue uses as the optimization target. Files are discarded.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LIMIT * 4) {
    return Response.json({ error: "Payload Too Large", maxSize: LIMIT }, { status: 413 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    return Response.json({ error: "Missing file field" }, { status: 400 });
  if (file.size > LIMIT) {
    return Response.json({ error: "Payload Too Large", maxSize: LIMIT }, { status: 413 });
  }
  return Response.json({ name: file.name, size: file.size, stored: false }, { status: 201 });
}
