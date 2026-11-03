import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photo: string }> },
) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const { id, photo } = await params;
  // RLS includes only booking participants or an authenticator-signed-in admin.
  const visible = await client
    .from("cleaning_job_photos")
    .select("storage_path")
    .eq("booking_id", id)
    .eq("id", photo)
    .maybeSingle();
  if (visible.error || !visible.data)
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  const { createClient: adminClient } = await import("@supabase/supabase-js");
  const admin = adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const downloaded = await admin.storage
    .from("cleaning-job-photos")
    .download(visible.data.storage_path);
  if (downloaded.error || !downloaded.data)
    return NextResponse.json({ error: "Photo unavailable." }, { status: 404 });
  return new Response(await downloaded.data.arrayBuffer(), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
