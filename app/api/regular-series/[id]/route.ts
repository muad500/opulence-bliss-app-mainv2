import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginMutation, readAccountBody } from "@/lib/accountApi";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id))
    return NextResponse.json({ error: "Series not found." }, { status: 404 });
  const client = await createClient();
  const { data, error } = await client.rpc("regular_series_billing_state", {
    p_series: id,
  });
  if (error)
    return NextResponse.json({ error: "Series not found." }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Use the website to resume your visits." },
      { status: 403 },
    );
  const { id } = await context.params;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (
    !uuid.test(id) ||
    body.action !== "resume" ||
    body.confirm !== true ||
    !Number.isSafeInteger(body.generation)
  )
    return NextResponse.json(
      { error: "Confirm the series you want to resume." },
      { status: 400 },
    );
  const client = await createClient();
  // The authenticated RPC checks customer ownership or administrator role.
  // No service-role proxy can turn a supplied series ID into permission.
  const { data, error } = await client.rpc("resume_regular_series", {
    p_series: id,
    p_generation: body.generation,
  });
  if (error)
    return NextResponse.json(
      {
        error:
          "The series changed or could not be resumed. Refresh and try again.",
      },
      { status: 409 },
    );
  return NextResponse.json(data);
}
