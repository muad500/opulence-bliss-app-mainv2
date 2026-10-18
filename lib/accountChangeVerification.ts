import "server-only";
import { createHash, createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { AccountContext } from "@/lib/accountApi";
import { createClient } from "@/lib/supabase/server";

export const accountChangeHash = (value: string) =>
  createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
    .update(value)
    .digest("hex");

export async function accountSessionId() {
  const client = await createClient();
  const { data } = await client.auth.getSession();
  try {
    const payload = JSON.parse(
      Buffer.from(
        data.session!.access_token.split(".")[1],
        "base64url",
      ).toString(),
    );
    return typeof payload.session_id === "string"
      ? (payload.session_id as string)
      : null;
  } catch {
    return null;
  }
}

export function needsAccountChangeCode(path: string) {
  return /^\/api\/account\/(profile|worker-profile|password|email|photo|payout-schedule|addresses(?:\/[^/]+)?|payout-account)$/.test(
    path,
  );
}

export async function verifyAccountChangeRequest(
  request: NextRequest,
  context: AccountContext,
) {
  if (!needsAccountChangeCode(request.nextUrl.pathname)) return null;
  const bytes = await request.clone().arrayBuffer();
  if (bytes.byteLength > 5 * 1024 * 1024)
    return NextResponse.json(
      { error: "This update is too large." },
      { status: 413 },
    );
  const digest = createHash("sha256")
    .update(request.method + "\n" + request.nextUrl.pathname + "\n")
    .update(Buffer.from(bytes))
    .digest("hex");
  const grant = request.headers.get("x-account-change-proof");
  const session = await accountSessionId();
  if (grant && session && /^[a-f0-9]{64}$/.test(grant)) {
    const result = await context.admin.rpc("consume_account_change", {
      p_user: context.user.id,
      p_session: session,
      p_hash: digest,
      p_grant: accountChangeHash(grant),
    });
    if (!result.error && result.data === true) return null;
  }
  return NextResponse.json(
    {
      error: "Confirm this change with a one-time code.",
      verificationRequired: true,
      requestHash: digest,
    },
    { status: 428 },
  );
}
