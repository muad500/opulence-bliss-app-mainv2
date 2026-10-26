import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import type { BookingLegalContract } from "@/lib/bookingLegalEvidence";

export default async function BookingLegalEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireAdminPage();
  const [result, email] = await Promise.all([
    supabase.rpc("booking_legal_contract", { p_booking: id }),
    supabase.rpc("admin_booking_legal_email_status", { p_booking: id }),
  ]);
  const contract = result.data as BookingLegalContract | null;
  return (
    <main
      style={{
        maxWidth: 850,
        margin: "0 auto",
        padding: "32px 20px 80px",
        lineHeight: 1.6,
      }}
    >
      <Link href="/admin/bookings">← Bookings</Link>
      <h1>Booking policy acceptance</h1>
      {result.error ? (
        <p role="alert">Could not load acceptance evidence.</p>
      ) : !contract ? (
        <p>
          This booking predates saved policy copies. Existing acceptance records
          remain on the booking.
        </p>
      ) : (
        <>
          <p>Booking {id}</p>
          <dl>
            <dt>Accepted at (UTC)</dt>
            <dd>{new Date(contract.acceptedAt).toISOString()}</dd>
            <dt>Account</dt>
            <dd>
              {contract.evidence.account?.name || "Name not recorded"} ·{" "}
              {contract.evidence.account?.email} ·{" "}
              {contract.evidence.account?.userId}
            </dd>
            <dt>IP address</dt>
            <dd>
              {contract.evidence.request.ip ||
                "Not supplied by the trusted host"}
            </dd>
            <dt>Browser</dt>
            <dd style={{ overflowWrap: "anywhere" }}>
              {contract.evidence.request.userAgent || "Not recorded"}
            </dd>
          </dl>
          <h2>Accepted documents</h2>
          <ul>
            {contract.documents.map((document) => (
              <li key={document.slug}>
                {document.title} · Version {document.version}
              </li>
            ))}
          </ul>
          <p>
            <a href={`/api/admin/bookings/${id}/legal-documents`}>
              Download accepted policies (PDF)
            </a>{" "}
            ·{" "}
            <a
              href={`/api/admin/bookings/${id}/legal-documents?form=cancellation`}
            >
              Download cancellation form
            </a>
          </p>
          <h2>Checkbox wording</h2>
          <ul>
            {contract.evidence.checkboxes.map((box) => (
              <li key={box.key}>Checked: {box.text}</li>
            ))}
          </ul>
          <h2>Contract email</h2>
          {email.error ? (
            <p>Delivery status is unavailable.</p>
          ) : email.data ? (
            <>
              <p>
                Status: {String(email.data.status).replaceAll("_", " ")} ·
                Attempts: {email.data.attempts}
                {email.data.sentAt
                  ? ` · Submitted ${new Date(email.data.sentAt).toISOString()}`
                  : ""}
              </p>
              {email.data.lastError && <p>{email.data.lastError}</p>}
              {email.data.status === "needs_review" && (
                <p>
                  Check the email provider delivery log before retrying.
                  Automatic retries stopped to avoid sending a duplicate.
                </p>
              )}
            </>
          ) : (
            <p>No contract email queued for this booking.</p>
          )}
        </>
      )}
    </main>
  );
}
