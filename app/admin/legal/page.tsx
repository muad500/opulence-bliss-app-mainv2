import { redirect } from "next/navigation";
import AdminNav from "../AdminNav";
import { createClient } from "@/lib/supabase/server";
import {
  LEGAL_DOCUMENT_SLUGS,
  defaultLegalDocument,
  sanitizeLegalHtml,
  type LegalDocument,
  type LegalDocumentSlug,
} from "@/lib/legalDocuments";
import LegalEditor from "./LegalEditor";
import styles from "./page.module.css";

type LegalRow = {
  slug: LegalDocumentSlug;
  title: string;
  audience: LegalDocument["audience"];
  content_html: string;
  version: string;
  updated_at: string;
};

export default async function AdminLegalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") redirect("/staff/login");

  const { data, error } = await supabase
    .from("legal_documents")
    .select("slug, title, audience, content_html, version, updated_at")
    .order("slug");
  const rows = (data ?? []) as LegalRow[];
  const documents = LEGAL_DOCUMENT_SLUGS.map((slug) => {
    const row = rows.find((candidate) => candidate.slug === slug);
    if (!row) return defaultLegalDocument(slug);
    return {
      slug,
      title: row.title,
      audience: row.audience,
      contentHtml: sanitizeLegalHtml(row.content_html),
      version: row.version,
      updatedAt: row.updated_at,
    } satisfies LegalDocument;
  });

  return (
    <main className={styles.shell}>
      <AdminNav email={user.email ?? "Admin"} />
      <div className={styles.page}>
        <p className={styles.eyebrow}>Website content</p>
        <h1>Legal documents</h1>
        <p className={styles.intro}>
          Edit the wording customers and professionals agree to. Use headings,
          bold text and lists to keep long documents readable.
        </p>
        {error && (
          <p className={styles.warning}>
            Starter drafts are shown because the legal-document migration has
            not been applied yet. Apply it before saving.
          </p>
        )}
        <div className={styles.editors}>
          {documents.map((document) => (
            <LegalEditor document={document} key={document.slug} />
          ))}
        </div>
      </div>
    </main>
  );
}
