import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/accountApi";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";

export const runtime = "nodejs";
const COOKIE = "__Host-opulence-cleaner-assessment";
const headers = { "Cache-Control": "private, no-store" };
const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
const validSecret = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function gate(request: NextRequest) {
  if (!cleanerStage2Enabled())
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Open the assessment from its invitation." },
      { status: 403, headers },
    );
  return null;
}
function server() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
async function body(request: NextRequest): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 16000) throw Error("Invalid request");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid request");
  return value;
}
function finish(data: Record<string, unknown>, session?: string) {
  const response = NextResponse.json(data, { headers });
  if (session)
    response.cookies.set(COOKIE, session, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 6 * 60 * 60,
    });
  // Human marking/review and the subsequent account-setup handoff still use
  // this limited capability. Only a final failure signs it out immediately.
  if (data.phase === "failed")
    response.cookies.set(COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
  return response;
}

/** A limited assessment capability, NOT an account/login token. Cannot be
 * used by Supabase, worker APIs, customer APIs or any staff endpoint. */
export async function POST(request: NextRequest) {
  const blocked = gate(request);
  if (blocked) return blocked;
  try {
    const input = await body(request);
    if (!validSecret(input.invitation) || input.rulesAccepted !== true)
      return NextResponse.json(
        { error: "Use your invitation and accept the assessment rules." },
        { status: 400, headers },
      );
    const session = randomBytes(32).toString("hex");
    const { data, error } = await server().rpc("cleaner_assessment_start", {
      p_invitation_hash: hash(input.invitation),
      p_session_hash: hash(session),
      p_rules_accepted: true,
    });
    if (error || !data)
      return NextResponse.json(
        { error: "The host must confirm attendance and open your assessment." },
        { status: 403, headers },
      );
    return finish(data, session);
  } catch {
    return NextResponse.json(
      { error: "Unable to start this assessment. Please ask the host." },
      { status: 400, headers },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const blocked = gate(request);
  if (blocked) return blocked;
  const session = request.cookies.get(COOKIE)?.value;
  if (!validSecret(session))
    return NextResponse.json(
      { error: "Your assessment session has ended." },
      { status: 401, headers },
    );
  try {
    const input = await body(request);
    if (
      typeof input.attemptId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(input.attemptId) ||
      ![
        "heartbeat",
        "answer",
        "page_left",
        "writing_save",
        "writing_submit",
      ].includes(String(input.action))
    )
      throw Error("Invalid action");
    const { data, error } = await server().rpc("cleaner_assessment_command", {
      p_session_hash: hash(session),
      p_attempt: input.attemptId,
      p_action: input.action,
      p_position: input.position ?? null,
      p_choice: input.choice ?? null,
      p_writing: input.writing ?? null,
    });
    if (error || !data) {
      const status = error?.code === "42501" ? 401 : 409;
      const response = NextResponse.json(
        { error: "This session or question is no longer available." },
        { status, headers },
      );
      if (status === 401)
        response.cookies.set(COOKIE, "", {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          path: "/",
          maxAge: 0,
        });
      return response;
    }
    return finish(data);
  } catch {
    return NextResponse.json(
      { error: "Invalid assessment request." },
      { status: 400, headers },
    );
  }
}
