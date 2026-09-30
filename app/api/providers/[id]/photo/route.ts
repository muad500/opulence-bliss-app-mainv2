import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const publicClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!);
  const { data: allowed, error } = await publicClient.rpc("public_eligible_provider_ids");
  if (error) return new NextResponse(null, { status: 503 });
  if (!(allowed ?? []).some((row: { id: string }) => row.id === id)) return new NextResponse(null, { status: 404 });
  const { data } = await admin.from("provider_profile_settings").select("photo_storage_path").eq("provider_id", id).maybeSingle();
  if (!data?.photo_storage_path) return new NextResponse(null, { status: 404 });
  const signed = await admin.storage.from("profile-photos").createSignedUrl(data.photo_storage_path, 60);
  if (!signed.data?.signedUrl) return new NextResponse(null, { status: 503 });
  return NextResponse.redirect(signed.data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
