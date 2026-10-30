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
  const finalPack = contract.documents.every(
    (document) =>
      Boolean(document.pdfSha256) && document.effectiveDate === "2026-10-01",
  );
  if (finalPack) {
    const { finalLegalPdf } = await import("./legalPackPdf");
    for (const slug of ["terms", "cancellation-refund"] as const) {
      const document = contract.documents.find((item) => item.slug === slug)!;
      attachments.push({
        filename: `${slug}-v1.0.pdf`,
        content: Buffer.from(
          await finalLegalPdf(slug, document.pdfSha256),
        ).toString("base64"),
      });
    }
    attachments.push({
      filename: "model-cancellation-form.pdf",
      content: Buffer.from(
        await generateCancellationFormPdf(contract.acceptedAt),
      ).toString("base64"),
    });
    const firstName =
      contract.evidence.account?.name?.trim().split(/\s+/)[0] || "Customer";
    const dateTime = (value: string) =>
      new Date(value).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        dateStyle: "long",
        timeStyle: "short",
      });
    if (
      !options.test &&
      contract.bookings.some(
        (booking) =>
          !Number.isFinite(booking.hours) ||
          !Number.isSafeInteger(booking.totalPaidPence),
      )
    )
      throw new Error("Confirmed booking summary is unavailable");
    return {
      from: options.from,
      to: [recipient],
      reply_to: "hello@opulencebliss.com",
      subject: `${options.test ? "TEST ONLY — " : ""}Your booking with Opulence Bliss is confirmed`,
      text: [
        ...(options.test
          ? [
              "TEST ONLY. No booking, charge or new policy acceptance has been created.",
            ]
          : []),
        `Hello ${firstName},`,
        "Thank you for booking with Opulence Bliss. Your booking is confirmed.",
        ...contract.bookings.map((booking) =>
          [
            `• Service: ${booking.service}`,
            `• Date and time: ${dateTime(booking.scheduledAt)}`,
            `• Hours: ${booking.hours ?? "Not applicable to this TEST"}`,
            `• Total paid: £${((booking.totalPaidPence ?? 0) / 100).toFixed(2)}. No VAT is charged.`,
            `• Booking reference: ${booking.id}`,
          ].join("\n"),
        ),
        `Your terms. We have attached the Customer Terms and Conditions (v1.0) and the Cancellations, Payment and Refunds Policy (v1.0) that you accepted on ${dateTime(contract.acceptedAt)}.`,
        "Cancelling. Free of charge up to 48 hours before your booking. 25% charge from 24 to 48 hours before. 50% charge from 12 to 24 hours before. Up to 70% charge less than 12 hours before or on the day. We encourage you to reschedule rather than cancel.",
        "Your right to cancel. You have the right to cancel within 14 days of today without giving a reason. To cancel, email hello@opulencebliss.com or use the form below.",
        ...(contract.evidence.checkboxes.some(
          (box) => box.key === "early_start",
        )
          ? [
              "You asked us to start within 14 days, so if you cancel after we have started, you pay for the part already provided.",
            ]
          : []),
        "Opulence Bliss Ltd, 128 City Road, London, United Kingdom, EC1V 2NX | Company number 15894675 | hello@opulencebliss.com",
      ].join("\n\n"),
      attachments,
    };
  }
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
