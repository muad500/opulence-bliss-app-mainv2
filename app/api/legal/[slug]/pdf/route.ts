import { finalLegalDocument } from "@/lib/finalLegalPack";
import { finalLegalPdf } from "@/lib/legalPackPdf";
import { createClient } from "@/lib/supabase/server";
import { generateAcceptedPolicyPdf } from "@/lib/bookingLegalPdf";
import {
  legalContentHash,
  type BookingLegalSnapshot,
} from "@/lib/bookingLegalEvidence";
import { publicLegalPresentation } from "@/lib/legalDocuments";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const document = finalLegalDocument(slug);
  if (!document || document.audience === "professionals")
    return new Response("Not found", { status: 404 });
  try {
    const revision = new URL(request.url).searchParams.get("revision");
    let bytes: Uint8Array;
    if (revision) {
      if (!/^\d+$/.test(revision))
        return new Response("Not found", { status: 404 });
      const client = await createClient();
      const { data, error } = await client.rpc("public_legal_revisions", {
        p_slug: slug,
      });
      const archived = data?.find(
        (item: { id: number }) => String(item.id) === revision,
      );
      if (error || !archived) return new Response("Not found", { status: 404 });
      const display = publicLegalPresentation(
        archived.title,
        archived.content_html,
      );
      const snapshot = {
        slug,
        ...display,
        version: archived.version,
        updatedAt: null,
        isFallback: false,
        sourceContentHtml: archived.content_html,
        contentHash: legalContentHash(archived.content_html),
        displayContentHash: legalContentHash(display.contentHtml),
      } as BookingLegalSnapshot;
      bytes = await generateAcceptedPolicyPdf(snapshot, archived.archived_at);
    } else bytes = await finalLegalPdf(slug);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="opulence-bliss-${slug}-${revision ? `archive-${revision}` : "v1.0"}.pdf"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Document unavailable", { status: 503 });
  }
}
