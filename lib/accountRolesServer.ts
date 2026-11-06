import "server-only";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import {
  isAccountRole,
  visibleAccountRoles,
  type AccountRoleRecord,
} from "./accountRoles";

export async function accountRoles() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await client.rpc("my_account_roles");
  if (error) throw Error("Account roles could not be loaded. Please retry.");
  const allRoles = (data ?? []) as AccountRoleRecord[];
  return {
    client,
    user,
    hasHandymanRole: allRoles.some((item) => item.role === "handyman"),
    roles: visibleAccountRoles(allRoles, handymanEnabled()),
  };
}
export async function requireAccountRole(value: string) {
  if (!isAccountRole(value)) notFound();
  const context = await accountRoles();
  const role = context.roles.find((item) => item.role === value);
  if (!role) notFound();
  return { ...context, role };
}
