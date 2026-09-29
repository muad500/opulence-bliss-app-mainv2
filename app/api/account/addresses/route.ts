import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, readAccountBody } from "@/lib/accountApi";
import { addressFields, addressResponse } from "@/lib/accountAddresses";

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  const fields = addressFields(body, true);
  if (fields instanceof NextResponse) return fields;
  const { count } = await ctx.admin.from("customer_addresses")
    .select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id);
  const makeDefault = body.isDefault === true || count === 0;
  const { data, error } = await ctx.admin.from("customer_addresses")
    .insert({ ...fields, user_id: ctx.user.id, is_default: false })
    .select("*").single();
  if (error || !data) return accountError("Address could not be saved.", 503);
  if (makeDefault) {
    const { error: defaultError } = await ctx.admin.rpc("set_default_customer_address", {
      p_user_id: ctx.user.id, p_address_id: data.id,
    });
    if (defaultError) return accountError("Address saved but could not be made the default.", 503);
    await ctx.admin.from("profiles").update({
      address: [data.line1, data.line2, data.city].filter(Boolean).join(", "),
      postcode: data.postcode,
    }).eq("id", ctx.user.id);
  }
  return NextResponse.json({ address: addressResponse({ ...data, is_default: makeDefault }) }, { status: 201 });
}
