import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { ROLE_LABELS, type AccountRoleRecord } from "@/lib/accountRoles";
export default async function ProfessionalDocumentUpdates() {
  const client = await createClient();
  const memberships = await client.rpc("my_account_roles");
  if (memberships.error)
    throw Error("Your document requirements could not be checked.");
  const roles = (memberships.data ?? ([] as AccountRoleRecord[])).filter(
    (r: AccountRoleRecord) =>
      r.role === "cleaner" || (r.role === "handyman" && handymanEnabled()),
  );
  const changes = await Promise.all(
    roles.map(async (role: AccountRoleRecord) => {
      const updates = await client.rpc("my_role_document_updates", {
        p_role: role.role,
      });
      if (updates.error) throw Error("Document updates could not be checked.");
      return { role: role.role, count: updates.data?.length ?? 0 };
    }),
  );
  const due = changes.filter((x) => x.count > 0);
  if (!due.length) return null;
  return (
    <aside
      role="status"
      style={{
        border: "1px solid var(--ob-border)",
        borderRadius: 16,
        padding: 20,
        marginBottom: 20,
      }}
    >
      <h2>Updated professional documents</h2>
      <p>
        Read the summary of changes and accept the new versions before taking
        new bookings in that role. Work already accepted remains available.
      </p>
      {due.map((item) => (
        <p key={item.role}>
          <Link href={`/account/roles/${item.role}/documents`}>
            {ROLE_LABELS[item.role]}: {item.count} document update
            {item.count === 1 ? "" : "s"}
          </Link>
        </p>
      ))}
    </aside>
  );
}
