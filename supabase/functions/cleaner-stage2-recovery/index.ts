// STAGING ONLY: no financial endpoint, no credential/body logging.
const encoder = new TextEncoder();
async function equal(a: string, b: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("stage2-comparison"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const one = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(a)),
  );
  const two = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(b)),
  );
  let mismatch = 0;
  for (let n = 0; n < one.length; n++) mismatch |= one[n] ^ two[n];
  return mismatch === 0;
}
Deno.serve(async (request: Request) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const response = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers });
  if (
    Deno.env.get("SUPABASE_URL") !== "https://comwdjprdedmsnxtvuuk.supabase.co"
  )
    return response(404, { error: "Not found" });
  const expected = Deno.env.get("VISIT_PAYMENTS_CRON_SECRET");
  if (
    request.method !== "POST" ||
    !expected ||
    !(await equal(
      request.headers.get("x-cleaner-stage2-secret") ?? "",
      expected,
    ))
  )
    return response(401, { error: "Unauthorized" });
  try {
    const text = await request.text();
    if (text.length > 5000)
      return response(413, { error: "Request too large" });
    const input = JSON.parse(text);
    if (
      typeof input.origin !== "string" ||
      !/^https:\/\/opulence-bliss-app-mainv2-[a-z0-9-]+-muad500s-projects\.vercel\.app$/.test(
        input.origin,
      ) ||
      typeof input.protectionBypass !== "string" ||
      !input.protectionBypass
    )
      return response(400, { error: "Staging configuration unavailable" });
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!service)
      return response(503, { error: "Worker credential unavailable" });
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(service),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode("opulence/staging/cleaner-stage2-scheduler/v1"),
      ),
    );
    const token = Array.from(signature, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const result = await fetch(input.origin + "/api/cron/cleaner-assessments", {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(110000),
      headers: {
        Authorization: `Bearer ${token}`,
        "x-vercel-protection-bypass": input.protectionBypass,
      },
    });
    if (!result.ok)
      return response(503, {
        error: "Staging recovery unavailable",
        upstreamStatus: result.status,
      });
    const counts = await result.json();
    return response(200, {
      ok: true,
      processed: counts.processed,
      followups: counts.followups,
      onboarding: counts.onboarding,
      decisions: counts.decisions,
      retention: counts.retention,
    });
  } catch {
    return response(503, { error: "Staging recovery unavailable" });
  }
});
