// Bounded private evidence parser. File names and browser MIME types are not
// trusted; HTML, SVG and executable payloads are never served as evidence.
export const PRIVATE_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
export async function privateDocumentForm(request: Request) {
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data") || !request.body)
    throw Error("Choose a document.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > PRIVATE_DOCUMENT_MAX_BYTES + 65536) {
      await reader.cancel();
      throw Error("Document too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new Response(bytes, {
    headers: { "content-type": contentType },
  }).formData();
}
export async function privateDocumentFile(file: FormDataEntryValue | null) {
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > PRIVATE_DOCUMENT_MAX_BYTES
  )
    throw Error("Choose a file no larger than 4 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind =
    bytes.length >= 5 && [37, 80, 68, 70, 45].every((n, i) => bytes[i] === n)
      ? ["application/pdf", "pdf"]
      : bytes.length >= 3 && [255, 216, 255].every((n, i) => bytes[i] === n)
        ? ["image/jpeg", "jpg"]
        : bytes.length >= 8 &&
            [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
          ? ["image/png", "png"]
          : null;
  if (!kind) throw Error("Choose a PDF, JPEG or PNG.");
  return {
    bytes,
    mime: kind[0],
    extension: kind[1],
    name:
      file.name
        .replace(/[\\/\x00-\x1f\x7f]/g, " ")
        .trim()
        .slice(0, 240) || "document",
  };
}
