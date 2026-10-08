import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ownsVoiceBooking, VoiceBookingError } from "@/lib/voiceBooking";
import { voiceBookingAdmin, voiceRequestByToken } from "@/lib/voiceBookingServer";
import { cleaningHomeLabel } from "@/lib/cleaningHome";
import { startsWithinCancellationPeriod } from "@/lib/cancellationPeriod";
import VoiceCheckoutButton from "./VoiceCheckoutButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review your booking | Opulence Bliss", robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };

export default async function VoiceBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) return <Message>This booking link is invalid. Please contact support.</Message>;
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/book/voice/${token}`)}`);
  try {
    const row = await voiceRequestByToken(voiceBookingAdmin(), token);
    if (!ownsVoiceBooking(user.email, user.email_confirmed_at, user.id, row)) return <Message>Sign in with the verified email address you gave the receptionist to view this booking. <Link href="/account">Manage your account</Link>.</Message>;
    if (Date.parse(row.expires_at) <= Date.now() && !row.checkout_session_id) return <Message>This booking request expired. Please ask the receptionist to prepare a new one.</Message>;
    const d = row.details;
    const appointment = new Date(d.slot).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" });
    return <main className="mx-auto max-w-2xl px-5 py-12">
      <p className="text-sm font-semibold text-purple-700">Opulence Bliss</p>
      <h1 className="mt-2 text-3xl font-bold">Your booking is ready to review</h1>
      <p className="mt-3 text-gray-600">Your receptionist has filled in the details. Check them below, then continue to secure payment.</p>
      <dl className="mt-7 grid gap-4 rounded-2xl border bg-white p-6">
        <Detail title="Service" value={row.quote.service} />
        <Detail title="Address" value={`${d.address}, ${d.postcode}`} />
        <Detail title="Home" value={cleaningHomeLabel(d.home)} />
        <Detail title="First visit" value={`${appointment} (London time)`} />
        <Detail title="Duration" value={`${d.duration_minutes / 60} hours per visit`} />
        <Detail title="Schedule" value={`${d.frequency.replace("_", " ")} · ${row.quote.visits} visit(s)`} />
        <Detail title="Contact number" value={d.phone} />
        {d.request && <Detail title="Requests" value={d.request} />}
        <Detail title="Total" value={`£${row.quote.total_gbp.toFixed(2)}`} />
      </dl>
      <p className="mt-5 text-sm text-gray-600">{d.frequency === "one_time" ? "Your card is authorised now and charged after the visit is completed." : "All regular visits are paid together upfront."} Your booking is confirmed after payment or card authorisation succeeds and it is saved. A cleaner is matched afterwards.</p>
      <VoiceCheckoutButton token={token} earlyStartRequired={startsWithinCancellationPeriod(d.slot)} />
      <p className="mt-5 text-sm text-gray-600">Need to change a detail? Ask the receptionist to prepare a new request before paying, or <Link className="underline" href="/book">edit your booking on the website</Link>.</p>
    </main>;
  } catch (error) {
    return <Message>{error instanceof VoiceBookingError ? error.message : "Your booking could not be loaded. Please try again or contact support."}</Message>;
  }
}

function Detail({ title, value }: { title: string; value: string }) { return <div><dt className="text-sm text-gray-500">{title}</dt><dd className="font-semibold">{value}</dd></div>; }
function Message({ children }: { children: React.ReactNode }) { return <main className="mx-auto max-w-xl px-5 py-16"><h1 className="mb-4 text-2xl font-bold">Your booking request</h1><p>{children}</p></main>; }
