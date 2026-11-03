import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import { deletionRequestAdminClient } from "../deletion-requests/data";
import StepForm from "./StepForm";
export default async function WelfarePage() {
  const { supabase } = await requireAdminPage();
  const result = await supabase
    .from("booking_checkin_safety_alerts")
    .select("booking_id,scheduled_at,provider_id,alerted_at")
    .order("alerted_at", { ascending: false })
    .limit(50);
  const admin = deletionRequestAdminClient();
  const alerts = await Promise.all(
    (result.data ?? []).map(async (alert) => {
      const steps = await supabase
        .from("booking_welfare_steps")
        .select("action,note,created_at,actor_id")
        .eq("booking_id", alert.booking_id)
        .eq("scheduled_at", alert.scheduled_at)
        .order("created_at");
      const provider = await admin
        ?.from("providers")
        .select("display_name,profile_id")
        .eq("id", alert.provider_id)
        .maybeSingle();
      const settings = await admin
        ?.from("provider_profile_settings")
        .select("emergency_contact_name,emergency_contact_phone")
        .eq("provider_id", alert.provider_id)
        .maybeSingle();
      const profile = provider?.data
        ? await admin
            ?.from("profiles")
            .select("phone")
            .eq("id", provider.data.profile_id)
            .maybeSingle()
        : null;
      return {
        ...alert,
        steps: steps.data ?? [],
        name: provider?.data?.display_name,
        phone: profile?.data?.phone,
        emergency: settings?.data,
      };
    }),
  );
  return (
    <main style={{ maxWidth: 1000, margin: "32px auto", padding: 24 }}>
      <Link href="/admin">← Admin</Link>
      <h1>Missed check-in: welfare follow-up</h1>
      <p>
        During 7am–8pm: after the 30-minute missed check-in alert, phone and
        message the cleaner. If there is no answer within 15 minutes, phone
        their emergency contact. If still unable to reach them and worried, ask
        the police for a welfare check at the booking address. In immediate
        danger, call 999 now—do not wait for this checklist.
      </p>
      <p>No calls are made automatically. Only log steps actually taken.</p>
      {result.error && <p>Alerts could not be loaded.</p>}
      {alerts.map((alert) => (
        <article
          key={alert.booking_id + alert.scheduled_at}
          style={{
            background: "white",
            padding: 20,
            border: "1px solid #ded5ec",
            borderRadius: 16,
            margin: "16px 0",
          }}
        >
          <h2>{alert.name ?? "Professional"}</h2>
          <p>
            Visit:{" "}
            {new Date(alert.scheduled_at).toLocaleString("en-GB", {
              timeZone: "Europe/London",
            })}
          </p>
          <p>
            Cleaner: {alert.phone ?? "No phone saved"} · Emergency contact:{" "}
            {alert.emergency?.emergency_contact_name ?? "Not recorded"}{" "}
            {alert.emergency?.emergency_contact_phone}
          </p>
          <Link href={`/admin/bookings?booking=${alert.booking_id}`}>
            Open booking and address
          </Link>
          <ol>
            {alert.steps.map((step) => (
              <li key={step.action}>
                {step.action.replaceAll("_", " ")} —{" "}
                {new Date(step.created_at).toLocaleString("en-GB", {
                  timeZone: "Europe/London",
                })}{" "}
                · Staff {step.actor_id}
                <p>{step.note}</p>
              </li>
            ))}
          </ol>
          {!alert.steps.some((step) => step.action === "resolved") && (
            <StepForm
              booking={alert.booking_id}
              scheduled={alert.scheduled_at}
            />
          )}
        </article>
      ))}
    </main>
  );
}
