import Link from "next/link";
import { requireAccountRole } from "@/lib/accountRolesServer";
import { ROLE_LABELS } from "@/lib/accountRoles";
export default async function RolePage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role, client } = await requireAccountRole((await params).role);
  const updates = await client.rpc("my_role_document_updates", {
    p_role: role.role,
  });
  if (updates.error) throw Error("Document updates could not be checked.");
  return (
    <main style={{ maxWidth: 850, margin: "auto", padding: 24 }}>
      <Link href="/account/roles">All my roles</Link>
      <h1>{ROLE_LABELS[role.role]} account</h1>
      <p>Status: {role.status.replaceAll("_", " ")}</p>
      {updates.data?.length > 0 && (
        <p role="status">
          <Link href={`/account/roles/${role.role}/documents`}>
            Read and accept your updated documents
          </Link>{" "}
          before taking new bookings.
        </p>
      )}
      <nav
        aria-label={`${ROLE_LABELS[role.role]} account`}
        style={{ display: "flex", flexWrap: "wrap", gap: 20 }}
      >
        <Link href={`/account/roles/${role.role}/documents`}>My documents</Link>
        <Link href={`/account/roles/${role.role}/pay`}>
          {role.role === "customer" ? "My receipts" : "My pay"}
        </Link>
        {role.role === "customer" && <Link href="/account">My bookings</Link>}
        {(role.role === "cleaner" || role.role === "handyman") &&
          role.status === "active" &&
          !updates.data?.length && (
            <Link
              href={`/worker/jobs?service=${role.role === "cleaner" ? "cleaning" : "handyman"}`}
            >
              My jobs
            </Link>
          )}
        {(role.role === "cleaner" || role.role === "handyman") &&
          role.status !== "active" && (
            <Link href="/worker/application">My application</Link>
          )}
      </nav>
      {role.role === "partner" && (
        <p>Partner referral and reward tools are not available yet.</p>
      )}
      <p>
        <Link href="/account/profile">
          Shared personal details and account settings
        </Link>
      </p>
    </main>
  );
}
