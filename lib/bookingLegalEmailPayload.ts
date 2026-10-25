import type { BookingLegalContract } from "./bookingLegalEvidence";
import {
  generateAcceptedPolicyPdf,
  generateCancellationFormPdf,
} from "./bookingLegalPdf";

export async function bookingLegalEmailPayload(
  contract: BookingLegalContract,
  recipient: string,
  options: { from: string; origin: string; test?: boolean },
) {
  if (
    contract.documents.length !== 3 ||
    (!options.test && !contract.bookings.length)
  )
    throw new Error("Accepted policy snapshots are unavailable");
  const attachments: Array<{ filename: string; content: string }> = [];
  for (const document of contract.documents)
    attachments.push({
      filename: `${document.slug}-version-${document.version.replace(/[^a-z0-9.-]/gi, "_")}.pdf`,
      content: Buffer.from(
        await generateAcceptedPolicyPdf(document, contract.acceptedAt),
      ).toString("base64"),
    });
  attachments.push({
    filename: "model-cancellation-form.pdf",
    content: Buffer.from(
      await generateCancellationFormPdf(contract.acceptedAt),
    ).toString("base64"),
  });
  const origin = options.origin.replace(/\/$/, "");
  return {
    from: options.from,
    to: [recipient],
    reply_to: "hello@opulencebliss.com",
    subject: `${options.test ? "TEST ONLY — " : ""}Your Opulence Bliss booking policies`,
    text: [
      options.test
        ? "TEST ONLY. This is a payment-free email delivery check using policy copies already saved during checkout. No booking, charge or new policy acceptance has been created."
        : "Thank you for booking with Opulence Bliss.",
      "Attached are the Terms & Conditions, Cancellation & Refund Policy and Privacy Policy versions you accepted, plus a model cancellation form. Keep these documents for your records.",
      `Accepted: ${new Date(contract.acceptedAt).toISOString()} (UTC).`,
      ...contract.bookings.map(
        (booking) =>
          `${booking.service} — ${new Date(booking.scheduledAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "long", timeStyle: "short" })} (London time). Reference: ${booking.id}.`,
      ),
      options.test
        ? `Download your checkout policy copy: ${origin}/api/account/checkout-policies/${contract.id}`
        : `View your booking: ${origin}/account/visit/${contract.bookings[0].id}`,
      "You do not have to use the attached form to cancel. Your accepted policies explain your cancellation rights. Contact hello@opulencebliss.com if you need help.",
    ].join("\n\n"),
    attachments,
  };
}
