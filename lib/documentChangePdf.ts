import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
export async function documentChangePdf(pdfPath: string, expectedHash: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}\/[a-z0-9-]+\.pdf$/.test(pdfPath) ||
    !/^[a-f0-9]{64}$/.test(expectedHash)
  )
    throw Error("Approved PDF unavailable.");
  const bytes = await readFile(
    path.join(process.cwd(), "legal-packs", pdfPath),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
    throw Error("Approved PDF fingerprint does not match.");
  return bytes;
}
