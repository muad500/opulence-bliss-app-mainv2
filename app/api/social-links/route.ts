import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { DEFAULT_SOCIAL_LINKS, socialLinksFromRows } from "@/lib/socialLinks";

export async function GET() {
  try {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    );
    const { data, error } = await client
      .from("site_social_links")
      .select("platform,url");
    if (error) throw error;
    return NextResponse.json(
      { links: socialLinksFromRows(data ?? []) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Preserve the existing public links while a deployment's migration is pending.
    return NextResponse.json(
      { links: DEFAULT_SOCIAL_LINKS },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
