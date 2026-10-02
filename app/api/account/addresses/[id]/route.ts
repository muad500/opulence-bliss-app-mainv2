import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, readAccountBody } from "@/lib/accountApi";
import { addressFields, addressResponse } from "@/lib/accountAddresses";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const { id } = await params;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  const fields = addressFields(body, false);
  if (fields instanceof NextResponse) return fields;
  const { data, error } = await ctx.admin.from("customer_addresses")
    .update(fields).eq("id", id).eq("user_id", ctx.user.id).select("*").maybeSingle();
  if (error) return accountError("Address could not be updated.", 503);
  if (!data) return accountError("Address not found.", 404);
  const makeDefault = body.isDefault === true;
  if (makeDefault) {
    const { error: defaultError } = await ctx.admin.rpc("set_default_customer_address", {
      p_user_id: ctx.user.id, p_address_id: id,
    });
    if (defaultError) return accountError("Address saved but could not be made the default.", 503);
  }
  if (makeDefault || data.is_default) {
    await ctx.admin.from("profiles").update({
      address: [data.line1, data.line2, data.city].filter(Boolean).join(", "),
      postcode: data.postcode,
    }).eq("id", ctx.user.id);
  }
  return NextResponse.json({ address: addressResponse({ ...data, is_default: makeDefault || data.is_default }) });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const { id } = await params;
  const { data, error } = await ctx.admin.from("customer_addresses")
    .delete().eq("id", id).eq("user_id", ctx.user.id).select("id,is_default").maybeSingle();
  if (error) return accountError("Address could not be removed.", 503);
  if (!data) return accountError("Address not found.", 404);
  if (data.is_default) {
    const { data: next } = await ctx.admin.from("customer_addresses")
      .select("id,line1,line2,city,postcode").eq("user_id", ctx.user.id)
      .order("created_at").limit(1).maybeSingle();
    if (next) {
      await ctx.admin.rpc("set_default_customer_address", { p_user_id: ctx.user.id, p_address_id: next.id });
      await ctx.admin.from("profiles").update({ address: [next.line1, next.line2, next.city].filter(Boolean).join(", "), postcode: next.postcode }).eq("id", ctx.user.id);
    } else {
      await ctx.admin.from("profiles").update({ address: null, postcode: null }).eq("id", ctx.user.id);
    }
  }
  return NextResponse.json({ ok: true });
}
