import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { finalLegalDocument } from "./finalLegalPack";

/** Immutable originals, kept outside public/ so professional PDFs do not leak
 * through the site's public asset directory. Callers select the audience route. */
export async function finalLegalPdf(slug: string, expectedHash?: string) {
  const document = finalLegalDocument(slug);
  if (!document || (expectedHash && document.pdfSha256 !== expectedHash))
    throw new Error("The accepted PDF version is unavailable");
  const bytes = await readFile(
    path.join(process.cwd(), "legal-packs", "2026-10-01", document.pdfFile),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== document.pdfSha256)
    throw new Error("The accepted PDF fingerprint does not match");
  return bytes;
}
