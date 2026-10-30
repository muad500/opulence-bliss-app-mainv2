import Link from "next/link";
import { notFound } from "next/navigation";
import { finalLegalDocument } from "@/lib/finalLegalPack";
import { sanitizeLegalHtml } from "@/lib/legalDocuments";
import styles from "@/app/legal/[slug]/page.module.css";

/** Applicants must be able to read the policies before creating an account.
 * These pages belong to registration and the portal, and are not footer links. */
export default async function ProfessionalPolicy({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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
