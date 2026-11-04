import ServiceReview from "../ServiceReview";
import PrivateVerificationPanel from "../PrivateVerificationPanel";
import DbsRecordPanel from "../DbsRecordPanel";
import { requireAdminPage } from "@/lib/adminSession";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { staffRoleAllows } from "@/lib/staffPermissions";
import {
  PROVIDER_DOCUMENT_TYPES,
  isPropertyMaintenanceDocument,
} from "@/lib/providerVerification";
export default async function OnboardingPage() {
  const { supabase, staffRole } = await requireAdminPage("onboarding");
  const { data, error } = await supabase
    .from("providers")
    .select("id,display_name,vetting_status,service_approvals,services")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw Error("Applications could not be loaded.");
  const enabled = handymanEnabled();
  return (
    <main style={{ padding: 24, maxWidth: 1000 }}>
      <h1>Professional onboarding</h1>
      <p>
        Record reviews within your staff role. Activation needs an independent
        second sign-off. Open private records only when needed; every opening
        and refusal is logged.
      </p>
      {(data ?? []).map((provider) => (
        <article
          key={provider.id}
          style={{
            marginBottom: 20,
            border: "1px solid var(--ob-border)",
            borderRadius: 18,
            padding: 20,
          }}
        >
          <h2>{provider.display_name ?? "Professional application"}</h2>
          <p>{provider.vetting_status}</p>
          <ServiceReview
            id={provider.id}
            approvals={provider.service_approvals}
            handymanEnabled={enabled}
            staffRole={staffRole}
          />
          {staffRoleAllows(staffRole, "private_evidence") && (
            <details>
              <summary>Private verification records</summary>
              {PROVIDER_DOCUMENT_TYPES.filter(
                (type) =>
                  !isPropertyMaintenanceDocument(type) ||
                  (enabled && provider.services?.includes("handyman")),
              ).map((type) => (
                <PrivateVerificationPanel
                  key={type}
                  providerId={provider.id}
                  type={type}
                />
              ))}
              <DbsRecordPanel id={provider.id} canView />
            </details>
          )}
        </article>
      ))}
      {!data?.length && <p>No professional applications.</p>}
    </main>
  );
}
