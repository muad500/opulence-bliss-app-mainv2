import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { createClient } from "@/lib/supabase/server";
import {
  defaultLegalDocument,
  isLegalDocumentSlug,
  publicLegalPresentation,
} from "@/lib/legalDocuments";
import { finalLegalDocument } from "@/lib/finalLegalPack";
import styles from "./page.module.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `${finalLegalDocument(slug)?.title ?? "Legal"} · Opulence Bliss`,
  };
}

export default async function LegalDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ revision?: string }>;
}) {
  const { slug } = await params;
  if (!isLegalDocumentSlug(slug)) notFound();
  const approved = finalLegalDocument(slug);
  if (approved?.audience === "professionals" || slug === "cleaner-terms")
    redirect(`/provider/join/policies/${slug}`);
  if (slug === "professional-partner-agreement")
    redirect("/provider/join/policies/professional-partner-agreement");
  const client = await createClient();
  const fallback = defaultLegalDocument(slug);
  const { data: row } = await client
    .from("legal_documents")
    .select("title,content_html,version,updated_at,effective_date,pdf_sha256")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  const { data: revisions } = await client.rpc("public_legal_revisions", {
    p_slug: slug,
  });
  const earlier = (revisions ?? []) as Array<{
    id: number;
    title: string;
    version: string;
    content_html: string;
    effective_date: string | null;
    archived_at: string;
  }>;
  const { revision } = await searchParams;
  if (revision && !/^\d+$/.test(revision)) notFound();
  const archived = revision
    ? earlier.find((item) => String(item.id) === revision)
    : null;
  if (revision && !archived) notFound();
  const document = archived ?? row;
  const presentation = document
    ? publicLegalPresentation(document.title, document.content_html)
    : { title: fallback.title, contentHtml: fallback.contentHtml };
  const version = document?.version ?? fallback.version;
  const effective =
    document?.effective_date ?? (!archived ? approved?.effectiveDate : null);
  const download = `/api/legal/${slug}/pdf${archived ? `?revision=${archived.id}` : ""}`;
  return (
    <>
      <main className={styles.shell}>
        <article className={styles.document}>
          <p className={styles.eyebrow}>
            {archived ? "Earlier version" : "Opulence Bliss legal"}
          </p>
          <h1>{presentation.title}</h1>
          <div className={styles.meta}>
            <span>Version {version}</span>
            {effective && (
              <span>
                Effective from:{" "}
                {new Date(`${effective}T00:00:00Z`).toLocaleDateString(
                  "en-GB",
                  {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  },
                )}
              </span>
            )}
          </div>
          <p>
            <a href={download}>Download PDF</a>
          </p>
          {archived && (
            <p>
              This is an earlier version.{" "}
              <Link href={`/legal/${slug}`}>Read the current document</Link>.
            </p>
          )}
          <div
            className={styles.content}
            dangerouslySetInnerHTML={{ __html: presentation.contentHtml }}
          />
          {slug === "privacy" && (
            <p>
              <Link href="/delete-account">Delete your account</Link>
            </p>
          )}
          {!!earlier.length && (
            <section aria-label="Earlier versions">
              <h2>Earlier versions</h2>
              <ul>
                {earlier.map((item) => (
                  <li key={item.id}>
                    <Link href={`/legal/${slug}?revision=${item.id}`}>
                      {item.title}, version {item.version} (archived{" "}
                      {new Date(item.archived_at).toLocaleDateString("en-GB", {
                        timeZone: "UTC",
                      })}
                      )
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
