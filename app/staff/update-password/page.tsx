import { UpdatePasswordForm } from "@/components/update-password-form";
import { requireStaffIdentity } from "@/lib/adminSession";
import { hasStaffTotpSession } from "@/lib/staffMfa";
import StaffMfa from "../mfa/StaffMfa";

export default async function StaffUpdatePasswordPage() {
  const { supabase, user } = await requireStaffIdentity();
  const claims = await supabase.auth.getClaims();
  if (claims.error || !hasStaffTotpSession(claims.data?.claims, user.factors))
    return <StaffMfa destination="/staff/update-password" />;
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <UpdatePasswordForm staff />
      </div>
    </main>
  );
}
