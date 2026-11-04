import Link from "next/link";
import { requireAccountRole } from "@/lib/accountRolesServer";
import {
  ROLE_LABELS,
  roleDocumentPath,
  verificationTypesForRole,
} from "@/lib/accountRoles";
import { sanitizeLegalHtml } from "@/lib/legalDocuments";
import { privatePortalClient } from "@/lib/professionalPortal";
import DocumentUpdateAcceptance from "@/components/DocumentUpdateAcceptance";
import type { DocumentUpdate } from "@/lib/documentChangePolicy";

export default async function RoleDocuments({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { client, user, role } = await requireAccountRole((await params).role);
  const binding = await client
    .from("account_role_document_bindings")
    .select("document_slug")
    .eq("role", role.role);
  if (binding.error) throw Error("Role documents could not be loaded.");
  const slugs = (binding.data ?? []).map((x) => x.document_slug);
  const [documents, acceptances, updates, versions] = await Promise.all([
    client
      .from("legal_documents")
      .select("slug,title,version,effective_date")
      .in("slug", slugs)
      .eq("published", true),
    privatePortalClient()
      .from("account_legal_acceptances")
      .select("document_slug,version,accepted_at")
      .eq("user_id", user.id)
      .in("document_slug", slugs),
    client.rpc("my_role_document_updates", { p_role: role.role }),
    client.rpc("my_role_document_versions", { p_role: role.role }),
  ]);
  if (documents.error || acceptances.error || updates.error || versions.error)
    throw Error("Documents could not be loaded.");
  const types = verificationTypesForRole(role.role);
  const { data: provider } = types.length
    ? await client
        .from("providers")
        .select("id")
        .eq("profile_id", user.id)
        .maybeSingle()
    : { data: null };
  const evidence = provider
    ? await privatePortalClient()
        .from("provider_verification_items")
        .select("document_type,label,status,expires_at")
        .eq("provider_id", provider.id)
        .in("document_type", types)
    : { data: [], error: null };
  if (evidence.error)
    throw Error("Your document statuses could not be loaded.");
  return (
    <main style={{ maxWidth: 850, margin: "auto", padding: 24 }}>
      <Link href={`/account/roles/${role.role}`}>
        Back to {ROLE_LABELS[role.role].toLowerCase()}
      </Link>
      <h1>{ROLE_LABELS[role.role]} documents</h1>
      {(updates.data ?? []).map((update: DocumentUpdate) => (
        <article
          key={update.id}
          style={{
            padding: 20,
            border: "1px solid var(--ob-border)",
            borderRadius: 16,
            marginBottom: 20,
          }}
        >
          <h2>
            {update.title} · Version {update.version}
          </h2>
          <h3>What changed</h3>
          <p style={{ whiteSpace: "pre-line" }}>{update.summary}</p>
          <p>
            Effective from{" "}
            {new Date(update.effective_at).toLocaleDateString("en-GB", {
              timeZone: "Europe/London",
            })}
          </p>
          <Link
            href={`/account/document-changes/${update.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read this document in a new tab
          </Link>
          <p>
            <a href={`/api/account/document-updates/${update.id}/pdf`}>
              Download this version&apos;s approved PDF
            </a>
          </p>
          <details>
            <summary>Read the approved wording here</summary>
            <div
              dangerouslySetInnerHTML={{
                __html: sanitizeLegalHtml(update.source_content_html),
              }}
            />
          </details>
          {role.role === "customer" ? (
            <p>You will be asked to accept this version when you next book.</p>
          ) : (
            <DocumentUpdateAcceptance
              role={role.role}
              plan={update.id}
              title={update.title}
              version={update.version}
            />
          )}
        </article>
      ))}
      <ul>
        {(documents.data ?? []).map((document) => {
          const accepted = acceptances.data?.find(
            (a) =>
              a.document_slug === document.slug &&
              a.version === document.version,
          );
          const version = versions.data?.find(
            (p: { document_slug: string; version: string }) =>
              p.document_slug === document.slug &&
              p.version === document.version,
          );
          return (
            <li key={document.slug} style={{ marginBottom: 12 }}>
              <Link
                href={
                  version
                    ? `/account/document-changes/${version.id}`
                    : roleDocumentPath(role.role, document.slug)
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                {document.title} · Version {document.version}
              </Link>
              {accepted && (
                <span>
                  {" "}
                  · Accepted{" "}
                  {new Date(accepted.accepted_at).toLocaleDateString("en-GB")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!!evidence.data?.length && (
        <>
          <h2>Verification for this role</h2>
          <ul>
            {evidence.data.map((d) => (
              <li key={d.document_type}>
                {d.label}: {d.status}
                {d.expires_at && ` · Expires ${d.expires_at}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
