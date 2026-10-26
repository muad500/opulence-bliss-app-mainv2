import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultLegalDocument,
  publicLegalPresentation,
  type LegalDocumentSlug,
} from "./legalDocuments";
import { legalContentHash } from "./bookingLegalEvidence";

export const OAUTH_ACCEPTANCE_COOKIE = "opulence-oauth-acceptance";
export type AcceptanceBox = { key: string; text: string; checked: true };
export type AcceptanceAction = {
  kind: "button";
  text: string;
  wording: string;
};
export async function prepareAccountAcceptance(
  client: SupabaseClient,
  slugs: LegalDocumentSlug[],
  headers: Headers,
  checkboxes: AcceptanceBox[],
  action?: AcceptanceAction,
) {
  const ready = await client.rpc("account_acceptance_evidence_ready");
  if (ready.error || ready.data !== true)
    throw Error("Account acceptance recording is being updated. Please retry.");
  const { data, error } = await client
    .from("legal_documents")
    .select("slug,title,version,updated_at,content_html")
    .in("slug", slugs)
    .eq("published", true);
  if (error) throw Error("Account policies are unavailable. Please retry.");
  const documents = slugs.map((slug) => {
    const fallback = defaultLegalDocument(slug),
      row = data?.find((item) => item.slug === slug);
    const source = row?.content_html || fallback.contentHtml;
    const display = row?.content_html
      ? publicLegalPresentation(row.title || fallback.title, source)
      : { title: fallback.title, contentHtml: source };
    return {
      slug,
      version: row?.content_html ? row.version : fallback.version,
      ...display,
      sourceContentHtml: source,
      contentHash: legalContentHash(source),
      displayContentHash: legalContentHash(display.contentHtml),
    };
  });
  const forwarded =
    process.env.VERCEL === "1"
      ? headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : null;
  return {
    schemaVersion: 1 as const,
    acceptedAt: new Date().toISOString(),
    request: {
      ip: forwarded && isIP(forwarded) ? forwarded : null,
      userAgent:
        headers
          .get("user-agent")
          ?.replace(/[\r\n\u0000]/g, " ")
          .slice(0, 500) || null,
    },
    checkboxes,
    ...(action ? { action } : {}),
    documents,
  };
}
export type AccountAcceptance = Awaited<
  ReturnType<typeof prepareAccountAcceptance>
>;
export async function saveAccountAcceptance(
  client: SupabaseClient,
  userId: string,
  prepared: AccountAcceptance,
  acceptedAt = prepared.acceptedAt,
) {
  const { documents, ...evidence } = prepared;
  const { error } = await client.from("account_legal_acceptances").upsert(
    documents.map((document) => ({
      user_id: userId,
      document_slug: document.slug,
      version: document.version,
      accepted_at: acceptedAt,
      acceptance_evidence: { ...evidence, document },
    })),
    {
      onConflict: "user_id,document_slug,version,booking_id",
      ignoreDuplicates: true,
    },
  );
  if (error)
    throw Error("Your acceptance evidence could not be saved. Please retry.");
}
function signingKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error("Account service unavailable");
  // Domain separation from the existing server credential. No new persistent key.
  return createHmac("sha256", key)
    .update("opulence/oauth-acceptance/v1")
    .digest();
}
export function signOAuthAcceptance(prepared: AccountAcceptance) {
  const { documents, ...evidence } = prepared;
  const payload = Buffer.from(
    JSON.stringify({
      ...evidence,
      documents: documents.map((d) => ({
        slug: d.slug,
        version: d.version,
        contentHash: d.contentHash,
        displayContentHash: d.displayContentHash,
      })),
      expires: Date.now() + 30 * 60_000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", signingKey())
    .update(payload)
    .digest("base64url");
  if (payload.length + signature.length > 3800)
    throw Error("Account policy evidence is too large");
  return payload + "." + signature;
}
export function readOAuthAcceptance(value: string | undefined) {
  try {
    if (!value || value.length > 3900) return null;
    const [payload, signature, ...extra] = value.split(".");
    if (extra.length) return null;
    const supplied = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", signingKey())
      .update(payload)
      .digest();
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return null;
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      parsed.expires <= Date.now() ||
      parsed.expires > Date.now() + 31 * 60_000 ||
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.documents) ||
      !Array.isArray(parsed.checkboxes)
    )
      return null;
    return parsed as Omit<AccountAcceptance, "documents"> & {
      documents: Array<{
        slug: LegalDocumentSlug;
        version: string;
        contentHash: string;
        displayContentHash: string;
      }>;
      expires: number;
    };
  } catch {
    return null;
  }
}
