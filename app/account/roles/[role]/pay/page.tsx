import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccountRole } from "@/lib/accountRolesServer";
import { ROLE_LABELS } from "@/lib/accountRoles";
import {
  allHandymanEarnings,
  privatePortalClient,
} from "@/lib/professionalPortal";
import { handymanEarnings } from "@/lib/professionalEarnings";
export default async function RolePay({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role, client, user } = await requireAccountRole((await params).role);
  if (role.role === "customer") redirect("/account/profile#payments");
  if (
    [
      "applied",
      "email_verified",
      "not_progressed",
      "declined",
      "pending",
    ].includes(role.status)
  )
    return (
      <main style={{ maxWidth: 850, margin: "auto", padding: 24 }}>
        <h1>{ROLE_LABELS[role.role]} pay</h1>
        <p>Pay tools unlock after this role is approved.</p>
        <Link href={`/account/roles/${role.role}`}>Back to my role</Link>
      </main>
    );
  if (role.role === "cleaner") redirect("/worker/earnings?role=cleaner");
  const { data: provider } =
    role.role === "handyman"
      ? await client
          .from("providers")
          .select("id")
          .eq("profile_id", user.id)
          .maybeSingle()
      : { data: null };
  const earnings = provider
    ? handymanEarnings(
        await allHandymanEarnings(privatePortalClient(), provider.id),
      )
    : null;
  return (
    <main style={{ maxWidth: 900, margin: "auto", padding: 24 }}>
      <Link href={`/account/roles/${role.role}`}>
        Back to {ROLE_LABELS[role.role].toLowerCase()}
      </Link>
      <h1>{ROLE_LABELS[role.role]} pay</h1>
      {role.role === "partner" ? (
        <p>
          Partner rewards are not available yet.{" "}
          {role.reward_route === "cleaner_payout"
            ? "Your Partner reward route is your normal cleaner payout."
            : "The Partner role uses gift card rewards, not cash payouts."}
        </p>
      ) : (
        <>
          <p>
            These are the professional payout amounts saved with your accepted
            property maintenance jobs. Cleaning earnings are shown in the
            cleaner role.
          </p>
          {earnings?.rows.length ? (
            <table>
              <caption>Property maintenance earnings</caption>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Date</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {earnings.rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      {row.service.replace("Handyman", "Property maintenance")}
                    </th>
                    <td>{new Date(row.when).toLocaleDateString("en-GB")}</td>
                    <td>£{row.amount.toFixed(2)}</td>
                    <td>{row.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No property maintenance earnings yet.</p>
          )}
        </>
      )}
    </main>
  );
}
