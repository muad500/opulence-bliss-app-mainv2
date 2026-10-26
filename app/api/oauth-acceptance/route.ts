import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginMutation } from "@/lib/accountApi";
import {
  prepareAccountAcceptance,
  signOAuthAcceptance,
  OAUTH_ACCEPTANCE_COOKIE,
} from "@/lib/accountAcceptanceServer";
import {
  CUSTOMER_SIGNUP_ACCEPTANCE,
  GOOGLE_LOGIN_ACCEPTANCE,
} from "@/lib/accountAcceptanceCopy";
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Open this request from the website." },
      { status: 403 },
    );
  const body = await request.json().catch(() => null);
  if (
    !body ||
    !["signup", "login"].includes(body.source) ||
    (body.source === "signup" && body.accepted !== true)
  )
    return NextResponse.json(
      { error: "Accept the account policies before continuing." },
      { status: 400 },
    );
  try {
    const prepared = await prepareAccountAcceptance(
      await createClient(),
      ["terms", "privacy", "cancellation-refund"],
      request.headers,
      body.source === "signup"
        ? [
            {
              key: "account_policies",
              text: CUSTOMER_SIGNUP_ACCEPTANCE,
              checked: true,
            },
          ]
        : [],
      body.source === "login"
        ? {
            kind: "button",
            text: "Continue with Google",
            wording: GOOGLE_LOGIN_ACCEPTANCE,
          }
        : undefined,
    );
    const response = NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(
      OAUTH_ACCEPTANCE_COOKIE,
      signOAuthAcceptance(prepared),
      {
        httpOnly: true,
        secure: request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/auth/callback",
        maxAge: 1800,
      },
    );
    return response;
  } catch {
    return NextResponse.json(
      { error: "Account policies could not be prepared. Please retry." },
      { status: 503 },
    );
  }
}
