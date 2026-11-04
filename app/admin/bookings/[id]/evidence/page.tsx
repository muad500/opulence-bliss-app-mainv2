import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import CleaningJobEvidenceSummary from "@/components/CleaningJobEvidenceSummary";
export default async function WorkEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  return (
    <main style={{ maxWidth: 900, margin: "32px auto", padding: 24 }}>
      <Link href="/admin/bookings">← Bookings</Link>
      <h1>Work checklist and photos</h1>
      <p>
        Private evidence for booking {id}. Only the booking participants and
        authenticator-signed-in staff can open its photos.
      </p>
      <CleaningJobEvidenceSummary bookingId={id} staff />
      <Link href={`/admin/cleaning-cancellations?booking=${id}`}>
        Recorded cancellation or stopped-visit decision →
      </Link>
    </main>
  );
}
