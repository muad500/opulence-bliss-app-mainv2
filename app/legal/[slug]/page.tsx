import type { Metadata } from "next";
import Link from "next/link";
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
    if (!row?.content_html) return slug === "safeguarding" ? null : fallback;
    return {
      slug,
      title: row.title.replace(/Handyman/gi, "Property maintenance"),
      audience: row.audience,
      contentHtml:
        slug === "safeguarding"
          ? sanitizeLegalHtml(row.content_html)
          : sanitizeLegalHtml(row.content_html).replace(/>[^<]+</g, (text) =>
              text
                .replace(/Handyman/gi, "Property maintenance")
                .replace(/Minor decorating/gi, "Painting &amp; decoration"),
            ),
      version: row.version,
      updatedAt: row.updated_at,
    } satisfies LegalDocument;
  } catch {
    return slug === "safeguarding" ? null : fallback;
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
          {slug === "privacy" && (
            <section
              className={styles.content}
              aria-labelledby="delete-account-heading"
            >
              <h2 id="delete-account-heading">Request account deletion</h2>
              <p>
                <Link href="/delete-account">Delete your account</Link>: how to
                send a request from your account settings or by email, and what
                information may need to be retained.
              </p>
            </section>
          )}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
