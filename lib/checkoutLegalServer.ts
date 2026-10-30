import "server-only";
import { finalLegalDocument } from "./finalLegalPack";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultLegalDocument,
  publicLegalPresentation,
} from "./legalDocuments";
import {
  legalContentHash,
  type BookingLegalSnapshot,
} from "./bookingLegalEvidence";
import {
  CHECKOUT_LEGAL_SLUGS,
  type CheckoutLegalDocument,
} from "./checkoutLegal";

// Mirrors the public legal page: use the published database document when it
// exists; otherwise the exact built-in document/version already served there.
// Never publish or modify policy rows as part of checkout.
export async function currentCheckoutLegal(client: SupabaseClient) {
  const { data, error } = await client
    .from("legal_documents")
    .select("slug,title,version,updated_at,content_html")
    .in("slug", [...CHECKOUT_LEGAL_SLUGS])
    .eq("published", true);
  if (error) throw new Error("Booking policies unavailable");
  const fallbacks = CHECKOUT_LEGAL_SLUGS.map((slug) => {
    const document = defaultLegalDocument(slug);
    return {
      slug,
      title: document.title,
      version: document.version,
      updatedAt: null,
      isFallback: true,
      contentHash: createHash("md5").update(document.contentHtml).digest("hex"),
    };
  });
  const documents: CheckoutLegalDocument[] = CHECKOUT_LEGAL_SLUGS.map(
    (slug) => {
      const row = data?.find((d) => d.slug === slug);
      return row?.content_html
        ? {
            slug,
            version: row.version,
            updatedAt: row.updated_at,
            isFallback: false,
          }
        : {
            slug,
            version: fallbacks.find((d) => d.slug === slug)!.version,
            updatedAt: null,
            isFallback: true,
          };
    },
  );
  const snapshots: BookingLegalSnapshot[] = CHECKOUT_LEGAL_SLUGS.map((slug) => {
    const row = data?.find((d) => d.slug === slug);
    const fallback = defaultLegalDocument(slug);
    const metadata = documents.find((d) => d.slug === slug)!;
    const source = row?.content_html || fallback.contentHtml;
    // Fallback pages have always displayed their built-in wording directly.
    const presentation = row?.content_html
      ? publicLegalPresentation(row.title || fallback.title, source)
      : { title: fallback.title, contentHtml: source };
    return {
      ...metadata,
      isFallback: Boolean(metadata.isFallback),
      ...presentation,
      sourceContentHtml: source,
      contentHash: legalContentHash(source),
      displayContentHash: legalContentHash(presentation.contentHtml),
      ...(source === finalLegalDocument(slug)?.contentHtml
        ? {
            pdfSha256: finalLegalDocument(slug)!.pdfSha256,
            effectiveDate: finalLegalDocument(slug)!.effectiveDate,
          }
        : {}),
    };
  });
  return { documents, fallbacks, snapshots };
}
