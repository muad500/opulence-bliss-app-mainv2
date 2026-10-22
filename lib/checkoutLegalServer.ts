import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultLegalDocument } from "./legalDocuments";
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
    .select("slug,version,updated_at,content_html")
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
  return { documents, fallbacks };
}
