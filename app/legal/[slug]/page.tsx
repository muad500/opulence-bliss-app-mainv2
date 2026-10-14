import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import SiteFooter from "@/components/SiteFooter";
import { createClient } from "@/lib/supabase/server";
import {
  defaultLegalDocument,
  isLegalDocumentSlug,
  sanitizeLegalHtml,
  type LegalDocument,
} from "@/lib/legalDocuments";
import styles from "./page.module.css";

type LegalRow = {
  slug: string;
  title: string;
  audience: LegalDocument["audience"];
  content_html: string;
  version: string;
  updated_at: string;
};

const loadDocument = cache(async (slug: string) => {
  if (!isLegalDocumentSlug(slug)) return null;

  const fallback = defaultLegalDocument(slug);
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("legal_documents")
      .select("slug, title, audience, content_html, version, updated_at")
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();
    const row = data as LegalRow | null;
    if (!row?.content_html) return fallback;
    return {
      slug,
      title: row.title.replace(/Handyman/gi, "Property maintenance"),
      audience: row.audience,
      contentHtml: sanitizeLegalHtml(row.content_html).replace(
        />[^<]+</g,
        (text) => text.replace(/Handyman/gi, "Property maintenance"),
      ),
      version: row.version,
      updatedAt: row.updated_at,
    } satisfies LegalDocument;
  } catch {
    return fallback;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const document = await loadDocument(slug);
  return {
    title: document
      ? `${document.title} · Opulence Bliss`
      : "Legal · Opulence Bliss",
  };
}

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const document = await loadDocument(slug);
  if (!document) notFound();

  const updated = document.updatedAt
    ? new Date(document.updatedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : document.version === "1.0"
      ? "August 2026"
      : "20 September 2026";

  return (
    <>
      <main className={styles.shell}>
        <article className={styles.document}>
          <p className={styles.eyebrow}>Opulence Bliss legal</p>
          <h1>{document.title}</h1>
          <div className={styles.meta}>
            <span>Version {document.version}</span>
            <span>Last updated {updated}</span>
          </div>
          <div
            className={styles.content}
            dangerouslySetInnerHTML={{ __html: document.contentHtml }}
          />
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
