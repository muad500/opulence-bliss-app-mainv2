import { finalLegalDocument } from "@/lib/finalLegalPack";
import { finalLegalPdf } from "@/lib/legalPackPdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const document = finalLegalDocument(slug);
  if (!document || document.audience !== "professionals")
    return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await finalLegalPdf(slug)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="opulence-bliss-${slug}-v1.0.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
