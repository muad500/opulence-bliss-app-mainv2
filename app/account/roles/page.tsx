import Link from "next/link";
import { accountRoles } from "@/lib/accountRolesServer";
import { ROLE_LABELS } from "@/lib/accountRoles";
export default async function RolesPage() {
  const { roles, hasHandymanRole } = await accountRoles();
  return (
    <main style={{ maxWidth: 900, margin: "auto", padding: 24 }}>
      <h1>Your account roles</h1>
      <p>
        One sign-in. Each role keeps its own application status, documents and
        payment records.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 16,
        }}
      >
        {roles.map((role) => (
          <article
            key={role.role}
            style={{
              border: "1px solid var(--ob-border)",
              borderRadius: 18,
              padding: 20,
            }}
          >
            <h2>{ROLE_LABELS[role.role]}</h2>
            <p>Status: {role.status.replaceAll("_", " ")}</p>
            <Link href={`/account/roles/${role.role}`}>
              Open {ROLE_LABELS[role.role].toLowerCase()}
            </Link>
          </article>
        ))}
      </div>
      {!roles.some(
        (item) => item.role === "cleaner" || item.role === "handyman",
      ) && (
        <p>
          <Link href="/provider/join">Apply as a professional</Link>
        </p>
      )}
      {!hasHandymanRole && !roles.some((item) => item.role === "partner") && (
        <p>
          <Link href="/partners">Learn about the Partner Programme</Link>
        </p>
      )}
    </main>
  );
}
