import type { SupabaseClient } from "@supabase/supabase-js";
import {
  complaintAcknowledgement,
  complaintReply,
  professionalWelcome,
  paymentReceipt,
} from "./launchOperationsCopy";
import { securityMailRecipientAllowed } from "./accountSecurityAlerts";
import { finalLegalPdf } from "./legalPackPdf";
import { generateAcceptedPolicyPdf } from "./bookingLegalPdf";
import type { BookingLegalSnapshot } from "./bookingLegalEvidence";

type Context = Record<string, unknown>;
export async function launchOperationsPayload(
  kind: string,
  context: Context,
  email: string,
  from: string,
  origin: string,
) {
  let subject: string, text: string;
  const attachments: { filename: string; content: string }[] = [];
  if (kind === "welcome") {
    const c = context as Omit<
      Parameters<typeof professionalWelcome>[0],
      "documents"
    > & {
      documents: Array<Omit<BookingLegalSnapshot, "slug"> & { slug: string }>;
    };
    if (
      !c.documents?.length ||
      !c.documents.some((d) => d.slug === ("dbs-data" as string))
    )
      throw Error("Accepted professional documents are missing");
    subject = "Welcome to Opulence Bliss";
    text = professionalWelcome(c);
    for (const document of c.documents) {
      const bytes = document.pdfSha256
        ? await finalLegalPdf(document.slug, document.pdfSha256)
        : await generateAcceptedPolicyPdf(
            { ...document, updatedAt: null },
            c.acceptedAt,
          );
      attachments.push({
        filename: `${document.slug}-v${document.version.replace(/[^a-z0-9.-]/gi, "_")}.pdf`,
        content: Buffer.from(bytes).toString("base64"),
      });
    }
  } else if (kind === "complaint_ack") {
    subject = "Your Opulence Bliss complaint acknowledgement";
    text = complaintAcknowledgement(
      context as Parameters<typeof complaintAcknowledgement>[0],
    );
  } else if (kind === "complaint_reply") {
    subject = "Our reply to your Opulence Bliss complaint";
    text = complaintReply(context as Parameters<typeof complaintReply>[0]);
  } else if (kind === "complaint_update") {
    subject = "Update on your Opulence Bliss complaint";
    text = `Your complaint (reference ${context.reference}) needs more time: ${context.reason}. We will reply in full by ${new Date(String(context.replyDueAt)).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "long", timeStyle: "short" })}. If you have more to tell us, please reply to this email.`;
  } else if (kind === "receipt") {
    subject = "Your Opulence Bliss payment receipt";
    text = paymentReceipt(context as Parameters<typeof paymentReceipt>[0]);
  } else if (kind === "replacement") {
    subject =
      "Your cleaner cannot attend — choose a replacement or cancel free";
    text = `Your cleaner cannot attend. We are offering your visit to another cleaner and will tell you who accepts. You may cancel this visit instead, at no charge, before it starts. Any payment for the visit will be refunded in full.\n\nOpen your visit to choose: ${origin.replace(/\/$/, "")}/account/visit/${context.bookingId}`;
  } else throw Error("Unknown operations email");
  return {
    from,
    to: [email],
    reply_to: "hello@opulencebliss.com",
    subject,
    text,
    ...(attachments.length ? { attachments } : {}),
  };
}

export async function deliverLaunchOperationsEmails(
  admin: SupabaseClient,
  env = process.env,
  transport: typeof fetch = fetch,
) {
  const key = env.RESEND_API_KEY,
    from = env.BOOKING_EMAIL_FROM ?? env.EMAIL_FROM,
    origin = env.NEXT_PUBLIC_SITE_URL;
  if (!key || !from || !origin?.startsWith("https://"))
    return { configured: false, sent: 0, failed: 0 };
  const rows = await admin.rpc("claim_launch_operation_emails");
  if (rows.error) throw Error("Operations email queue unavailable");
  let sent = 0,
    failed = 0;
  for (const row of rows.data ?? []) {
    let ok = false;
    try {
      if (!securityMailRecipientAllowed(row.email, env))
        throw Error("Staging recipient not allowed");
      let payload = row.payload;
      if (!payload) {
        const built = await launchOperationsPayload(
          row.kind,
          row.context,
          row.email,
          from,
          origin,
        );
        const saved = await admin.rpc("store_launch_operation_payload", {
          p_id: row.id,
          p_token: row.claim_token,
          p_payload: built,
        });
        if (saved.error || !saved.data)
          throw Error("Email snapshot could not be saved");
        payload = saved.data;
      }
      const response = await transport("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `launch-operation/${row.id}`,
        },
        body: JSON.stringify(payload),
      });
      ok = response.ok;
    } catch {
      /* Retain the same payload and operation ID for a bounded retry. */
    }
    const saved = await admin.rpc("finish_launch_operation_email", {
      p_id: row.id,
      p_token: row.claim_token,
      p_ok: ok,
    });
    if (ok && !saved.error && saved.data) sent++;
    else failed++;
  }
  return { configured: true, sent, failed };
}
