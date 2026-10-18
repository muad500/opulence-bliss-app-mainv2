import { NextRequest, NextResponse } from "next/server";
import {
  accountContext,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import { savePayoutSchedule } from "@/app/worker/earnings/actions";
export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, {
    provider: true,
    approvedProvider: true,
    mutation: true,
  });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  const form = new FormData();
  form.set("schedule", String(body.schedule ?? ""));
  const result = await savePayoutSchedule({ ok: false, message: "" }, form);
  return NextResponse.json(result.ok ? result : { error: result.message }, {
    status: result.ok ? 200 : 400,
  });
}
