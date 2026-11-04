const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "long",
    timeStyle: "short",
  });
export function complaintAcknowledgement(c: {
  reference: string;
  receivedAt: string;
  handler: string;
  replyDueAt: string;
}) {
  return `Thank you for contacting Opulence Bliss. We have received your complaint (reference ${c.reference}) on ${when(c.receivedAt)}. ${c.handler} is looking into it. We will reply in full by ${when(c.replyDueAt)}. If you have more to tell us, please reply to this email.`;
}
export function complaintReply(c: {
  reference: string;
  checked: string;
  findings: string;
  action: string;
}) {
  return `Thank you for your complaint (reference ${c.reference}). We looked at ${c.checked}. We found ${c.findings}. We will ${c.action}. If you are not happy with this reply, you can ask us to review it by writing to hello@opulencebliss.com within 14 days. After that you can also take legal action or use mediation, and you can get free advice from Citizens Advice. If your complaint is about personal information, you can complain to the Information Commissioner's Office at ico.org.uk.`;
}
export function professionalWelcome(c: {
  firstName: string;
  acceptedAt: string;
  documents: { title: string; version: string }[];
  handyman: boolean;
}) {
  const documents = c.documents
    .map((d) => `${d.title} (v${d.version})`)
    .join(", ");
  return [
    `Hello ${c.firstName},`,
    "Your account has been created.",
    `We have attached the ${documents} that you accepted on ${when(c.acceptedAt)}.`,
    `Next steps: send us your basic DBS certificate, your insurance certificate, ${c.handyman ? "your Gas Safe or electrical registration where relevant, " : ""}and your right-to-work documents. You can get a basic DBS check at https://www.gov.uk/request-copy-criminal-record. You can start taking bookings once we have checked everything.`,
    "If you have any questions, email hello@opulencebliss.com.",
  ].join("\n\n");
}
export function paymentReceipt(c: {
  reference: string;
  bookingId: string;
  amountPence: number;
  paidAt: string;
  service: string | null;
  kind: string;
}) {
  if (!Number.isSafeInteger(c.amountPence) || c.amountPence <= 0)
    throw Error("Invalid payment receipt amount");
  return [
    "Thank you. We received your payment.",
    `Payment reference: ${c.reference}`,
    `Booking reference: ${c.bookingId}`,
    `Service: ${c.service ?? "Your booking"}`,
    `Payment: ${c.kind === "tip" ? "Optional tip" : "Booking or agreed additional service"}`,
    `Paid: £${(c.amountPence / 100).toFixed(2)}`,
    "No VAT is charged.",
    `Payment date: ${when(c.paidAt)}`,
    "Opulence Bliss Ltd | Company number 15894675 | 128 City Road, London, EC1V 2NX | hello@opulencebliss.com",
  ].join("\n\n");
}
