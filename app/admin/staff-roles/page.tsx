import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import StaffRoleForm from "./StaffRoleForm";
export default async function StaffRolesPage() {
  const { supabase, user } = await requireAdminPage();
  const [people, scopes, audit] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,full_name")
      .eq("role", "admin")
      .is("account_deleted_at", null)
      .order("full_name"),
    supabase
      .from("staff_role_memberships")
      .select("profile_id,staff_role,active"),
    supabase
      .from("staff_role_audit")
      .select(
        "id,profile_id,actor_id,previous_role,staff_role,active,reason,created_at",
      )
      .order("id", { ascending: false })
      .limit(30),
  ]);
  if (people.error || scopes.error || audit.error)
    throw Error("Staff permissions could not be loaded.");
  return (
    <main style={{ padding: 24, maxWidth: 1000 }}>
      <h1>Staff permissions</h1>
      <p>
        Every staff role requires authenticator sign-in. Private identity and
        DBS evidence also requires the separate named onboarding list. Developer
        accounts cannot read it.
      </p>
      <p>
        <Link href="/admin/staff-invitations">
          Invite a named staff account
        </Link>
      </p>
      {(people.data ?? []).map((person) => {
        const scope = scopes.data?.find((row) => row.profile_id === person.id);
        return (
          <section
            key={person.id}
            style={{
              border: "1px solid var(--ob-border)",
              padding: 20,
              borderRadius: 16,
              marginBottom: 16,
            }}
          >
            <h2>{person.full_name ?? person.email}</h2>
            <p>{person.email}</p>
            {person.id === user.id ? (
              <p>
                Your role: {scope?.staff_role ?? "unassigned"}. Another Manager
                must change your access.
              </p>
            ) : (
              <StaffRoleForm
                profile={person.id}
                role={scope?.staff_role ?? "onboarding"}
                active={scope?.active ?? false}
              />
            )}
          </section>
        );
      })}
      <h2>Permission changes</h2>
      <ul>
        {(audit.data ?? []).map((row) => (
          <li key={row.id}>
            {row.created_at}: {row.profile_id} → {row.staff_role},{" "}
            {row.active ? "active" : "disabled"}; by {row.actor_id}.{" "}
            {row.reason}
          </li>
        ))}
      </ul>
    </main>
  );
}
