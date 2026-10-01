/** Limit streamed uploads, including requests without Content-Length. */
export async function boundedFormData(request: Request, maxBytes: number): Promise<FormData | null> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data") || !request.body) return null;
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Response(bytes, { headers: { "content-type": contentType } }).formData();
}
