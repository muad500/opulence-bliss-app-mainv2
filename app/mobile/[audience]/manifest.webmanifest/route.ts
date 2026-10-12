import { mobileManifest } from "@/lib/mobileManifest";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ audience: string }> },
) {
  const { audience } = await params;
  if (audience !== "customer" && audience !== "worker")
    return new Response("Not found", { status: 404 });
  return Response.json(mobileManifest(audience), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public,max-age=3600",
    },
  });
}
