import { redirect } from "next/navigation";
import { requireStaffIdentity } from "@/lib/adminSession";
import { hasStaffTotpSession } from "@/lib/staffMfa";
import StaffMfa from "./StaffMfa";

export const metadata = {
  title: "Staff two-step sign-in | Opulence Bliss",
  robots: { index: false, follow: false },
};
export default async function StaffMfaPage() {
  const { supabase, user } = await requireStaffIdentity();
  const { data, error } = await supabase.auth.getClaims();
  if (!error && hasStaffTotpSession(data?.claims, user.factors))
    redirect("/admin");
  return <StaffMfa />;
}
