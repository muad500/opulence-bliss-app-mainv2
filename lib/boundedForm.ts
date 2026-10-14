import type { NextRequest } from "next/server";
/** Bound the stream even when content-length is absent or dishonest. */
export async function boundedFormData(request: NextRequest, limit: number) {
  if (
    !request.body ||
    Number(request.headers.get("content-length") || 0) > limit
  )
    throw new Error("The upload is too large.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error("The upload is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes, {
    headers: { "content-type": request.headers.get("content-type")! },
  }).formData();
}
