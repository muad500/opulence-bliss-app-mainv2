import { NextRequest, NextResponse } from "next/server";
import {
  accountContext,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import { createClient } from "@/lib/supabase/server";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import {
  accountRoleDestination,
  visibleAccountRoles,
  type AccountRoleRecord,
} from "@/lib/accountRoles";

async function load() {
  const client = await createClient();
  const result = await client.rpc("my_account_roles");
  if (result.error) return null;
  return visibleAccountRoles(
    (result.data ?? []) as AccountRoleRecord[],
    handymanEnabled(),
  );
}
export async function GET(request: NextRequest) {
  const context = await accountContext(request);
  if (isAccountError(context)) return context;
  const roles = await load();
  return roles
    ? NextResponse.json(
        { roles },
        { headers: { "Cache-Control": "private, no-store" } },
      )
    : NextResponse.json(
        { error: "Account roles are being updated." },
        { status: 503 },
      );
}
export async function POST(request: NextRequest) {
  const context = await accountContext(request, { mutation: true });
  if (isAccountError(context)) return context;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  const roles = await load();
  if (!roles)
    return NextResponse.json(
      { error: "Account roles are being updated." },
      { status: 503 },
    );
  const role = roles.find((item) => item.role === body.role);
  if (!role)
    return NextResponse.json(
      { error: "This account role is unavailable." },
      { status: 403 },
    );
  // Switching is navigation only: never create a membership, approve a role,
  // change a pay setting, or write a persistent preference.
  return NextResponse.json({
    role: role.role,
    href: accountRoleDestination(role.role, role.status),
  });
}
