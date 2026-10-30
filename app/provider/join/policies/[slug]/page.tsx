import Link from "next/link";
import { notFound } from "next/navigation";
import { finalLegalDocument } from "@/lib/finalLegalPack";
import { sanitizeLegalHtml } from "@/lib/legalDocuments";
import { defaultLegalDocument } from "@/lib/legalDocuments";
import { publicLegalPresentation } from "@/lib/legalDocuments";
import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";
import styles from "@/app/legal/[slug]/page.module.css";

/** Applicants must be able to read the policies before creating an account.
 * These pages belong to registration and the portal, and are not footer links. */
export default async function ProfessionalPolicy({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug === "professional-partner-agreement") {
    const fallback = defaultLegalDocument(slug);
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: row, error } = await client
      .from("legal_documents")
      .select("title,version,content_html")
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw new Error("Current agreement unavailable. Please retry.");
    const presentation = row?.content_html
      ? publicLegalPresentation(row.title, row.content_html)
      : { title: fallback.title, contentHtml: fallback.contentHtml };
    const agreement = {
      ...presentation,
      version: row?.version ?? fallback.version,
    };
    return (
      <main className={styles.shell}>
        <article className={styles.document}>
          <p className={styles.eyebrow}>Current cleaner agreement</p>
          <h1>{agreement.title}</h1>
          <p>Version {agreement.version}</p>
          <div
            className={styles.content}
            dangerouslySetInnerHTML={{
              __html: sanitizeLegalHtml(agreement.contentHtml),
            }}
          />
          <Link href="/provider/join">Return to professional sign-up</Link>
        </article>
      </main>
    );
  }
  if (slug === "cleaner-terms")
    return (
      <main className={styles.shell}>
        <article className={styles.document}>
          <h1>Cleaner Terms and Conditions</h1>
          <p>
            The client has not yet supplied the Cleaner Terms. This placeholder
            is not an agreement and cannot be accepted.
          </p>
          <Link href="/provider/join">Return to professional sign-up</Link>
        </article>
      </main>
    );
  const document = finalLegalDocument(slug);
  if (!document || document.audience !== "professionals") notFound();
  return (
    <main className={styles.shell}>
      <article className={styles.document}>
        <p className={styles.eyebrow}>Professional policies</p>
        <h1>{document.title}</h1>
        <p>Version 1.0 · Effective from: 1 October 2026</p>
        <a href={`/provider/join/policies/${slug}/pdf`}>Download PDF</a>
        <div
          className={styles.content}
          dangerouslySetInnerHTML={{
            __html: sanitizeLegalHtml(document.contentHtml),
          }}
        />
        <Link href="/provider/join">Return to professional sign-up</Link>
      </article>
    </main>
  );
}
