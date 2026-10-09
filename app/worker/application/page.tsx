import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  canUseProfessionalTools,
  professionalStatusLabel,
} from "@/lib/professionalAccess";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { visibleProfessionalServices } from "@/lib/professionalServices";
import styles from "./application.module.css";

export default async function ApplicationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/provider/login");
  const { data: provider } = await supabase
    .from("providers")
    .select("id,vetting_status,is_suspended,service_approvals")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!provider) redirect("/provider/join");
  if (canUseProfessionalTools(provider)) redirect("/worker");
  const [{ data: dbs }, { data: documents }] = await Promise.all([
    supabase
      .from("provider_dbs_checks")
      .select("status,uploaded_at")
      .eq("provider_id", provider.id)
      .maybeSingle(),
    supabase
      .from("provider_verification_items")
      .select("document_type,status,uploaded_at")
      .eq("provider_id", provider.id)
      .in("document_type", ["right_to_work", "photo_id"]),
  ]);
  const checks = [
    {
      label: "DBS certificate",
      status: dbs?.uploaded_at ? dbs.status : "not_submitted",
    },
    ...[
      ["right_to_work", "Right to work for self-employed services"],
      ["photo_id", "Photo ID"],
    ].map(([type, label]) => {
      const item = documents?.find((doc) => doc.document_type === type);
      return {
        label,
        status: item?.uploaded_at ? item.status : "not_submitted",
      };
    }),
  ];
  const needsAttention =
    provider.is_suspended || provider.vetting_status === "rejected";
  return (
    <main className={styles.page}>
      <header>
        <p className={styles.eyebrow}>Professional application</p>
        <h1>My application</h1>
        <span className={styles.status}>
          {professionalStatusLabel(provider)}
        </span>
        <p>
          {needsAttention
            ? "Contact support about your application status. Your customer account remains available."
            : "Your professional application is separate from your customer account. Submit your evidence here; our team must review it before you can start receiving jobs."}
        </p>
      </header>
      <section className={styles.card}>
        <h2>Services</h2>
        <ul>
          {visibleProfessionalServices(
            Object.keys(provider.service_approvals ?? {}),
            handymanEnabled(),
          ).map((service) => (
            <li key={service}>
              <strong style={{ textTransform: "capitalize" }}>{service}</strong>
              <span>{provider.service_approvals[service]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.card}>
        <h2>Complete your verification</h2>
        <p>
          We check your identity, DBS certificate and whether your UK permission
          allows these services on a self-employed basis. Choosing a resident
          status or ticking a box does not verify your right to work.
        </p>
        <ul>
          {checks.map((check) => (
            <li key={check.label}>
              <strong>{check.label}</strong>
              <span>
                {check.status === "verified"
                  ? "Verified"
                  : check.status === "pending"
                    ? "Submitted — awaiting review"
                    : check.status === "not_submitted"
                      ? "Evidence needed"
                      : "Needs attention"}
              </span>
            </li>
          ))}
        </ul>
        <Link className={styles.button} href="/worker/profile#verification">
          Complete profile and upload evidence
        </Link>
      </section>
      <section className={styles.card}>
        <h2>Working tools are locked</h2>
        <p>
          Jobs and offers, working availability, earnings and payout settings
          unlock only after administrator approval. Availability supplied in
          your application is for review.
        </p>
        <p>
          UTR and a trading or business name are optional. You can leave them
          blank.
        </p>
      </section>
      <div className={styles.links}>
        <Link href="/account">Back to customer account</Link>
        <Link href="/faq">Help and support</Link>
      </div>
    </main>
  );
}
