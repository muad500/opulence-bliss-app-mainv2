import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { deploymentOrigins } from "@/lib/adminHosts";

export default function StaffForgotPasswordPage() {
  const { admin } = deploymentOrigins(process.env);
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <ForgotPasswordForm staff resetRedirect={`${admin}/staff/callback`} />
      </div>
    </main>
  );
}
