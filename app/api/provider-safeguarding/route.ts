import { createClient } from "@/lib/supabase/server";
import { defaultLegalDocument } from "@/lib/legalDocuments";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const client = await createClient();
    const { data, error } = await client
      .from("legal_documents")
      .select("version,content_html")
      .eq("slug", "safeguarding")
      .eq("published", true)
      .maybeSingle();
    if (error) throw error;
    return Response.json(
      {
        version: data?.content_html
          ? data.version
          : defaultLegalDocument("safeguarding").version,
        href: "/legal/safeguarding",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "The safeguarding policy could not be loaded." },
      { status: 503 },
    );
  }
}
