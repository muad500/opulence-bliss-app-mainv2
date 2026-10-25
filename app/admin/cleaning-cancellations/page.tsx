import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import CleaningCancellationCompensation from "@/components/CleaningCancellationCompensation";
export default async function CleaningCancellationsPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { supabase } = await requireAdminPage();
  const { booking } = await searchParams;
  const id = booking && /^[0-9a-f-]{36}$/i.test(booking) ? booking : undefined;
  const { data } = id
    ? await supabase
        .from("booking_cleaning_billing_terms")
        .select("terms")
        .eq("booking_id", id)
        .maybeSingle()
    : { data: null };
  const noAccessMax =
    data?.terms?.cancellationBasis === "cleaning_hours" ? 70 : 100;
  return (
    <main style={{ maxWidth: 1000, margin: "32px auto", padding: 24 }}>
      <Link href="/admin/review">← Resolution desk</Link>
      <h1>Cleaning cancellations</h1>
      <CleaningCancellationCompensation
        admin
        bookingId={id}
        noAccessMax={noAccessMax}
      />
    </main>
  );
}
