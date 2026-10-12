import certificate from "@/mobile/android/signing-certificate.json";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const host = (request.headers.get("host") || new URL(request.url).host)
    .split(":")[0]
    .toLowerCase();
  if (host !== "www.opulencebliss.com") {
    return new Response("Not found", { status: 404 });
  }

  return Response.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: certificate.packageName,
          sha256_cert_fingerprints: [certificate.sha256Fingerprint],
        },
      },
    ],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
