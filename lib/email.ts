// Email via Resend. Save at: lib/email.ts
//
// Add to .env.local:
//   RESEND_API_KEY=re_xxxxxxxx
//   EMAIL_FROM=Opulence Bliss <onboarding@resend.dev>
//
// If RESEND_API_KEY isn't set, these calls quietly do nothing — the app
// keeps working, you just don't get email.

const DEFAULT_FROM = "Opulence Bliss <onboarding@resend.dev>";
const CONFIGURED_SENDERS = [
  process.env.BOOKING_EMAIL_FROM,
  process.env.EMAIL_FROM,
  DEFAULT_FROM,
].filter((sender, index, senders): sender is string =>
  Boolean(sender) && senders.indexOf(sender) === index
);

type EmailFailureReason =
  | "not_configured"
  | "sender_not_verified"
  | "invalid_api_key"
  | "delivery_failed";

let discoveredSender: string | null | undefined;

/** Where this app lives. Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

/** Turn "/account" into a full link; leave absolute URLs alone. */
function absolute(url: string) {
  return url.startsWith("/") ? `${SITE}${url}` : url;
}

function wrap(title: string, body: string, cta?: { text: string; url: string }) {
  return `
<div style="background:#fbf7f0;padding:32px 16px;font-family:-apple-system,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #ece5d8;border-radius:16px;padding:32px 30px;">
    <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#cf854f;font-weight:600;margin:0 0 6px;">
      Opulence Bliss
    </p>
    <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;color:#2f4a3a;margin:0 0 14px;">
      ${title}
    </h1>
    <div style="color:#4a544c;font-size:15px;line-height:1.6;">${body}</div>
    ${
      cta
        ? `<p style="margin:26px 0 0;">
             <a href="${absolute(cta.url)}" style="display:inline-block;background:#2f4a3a;color:#fbf7f0;
                text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;font-size:14px;">
               ${cta.text}
             </a>
           </p>`
        : ""
    }
    <p style="color:#a89f90;font-size:12px;margin:28px 0 0;border-top:1px solid #f0ebe0;padding-top:16px;">
      Premium home cleaning, London.
    </p>
  </div>
</div>`.trim();
}

function deliveryFailure(status: number, responseBody: string): EmailFailureReason {
  const normalized = responseBody.toLowerCase();
  if (
    normalized.includes("domain") &&
    (normalized.includes("verif") || normalized.includes("testing emails"))
  ) {
    return "sender_not_verified";
  }
  if (status === 401 || normalized.includes("api key")) return "invalid_api_key";
  return "delivery_failed";
}

async function findVerifiedSender(key: string) {
  if (discoveredSender !== undefined) return discoveredSender;

  try {
    const response = await fetch("https://api.resend.com/domains?limit=100", {
      headers: {
        Authorization: `Bearer ${key}`,
        "User-Agent": "opulence-bliss/1.0",
      },
    });
    if (!response.ok) {
      discoveredSender = null;
      return null;
    }

    const result = (await response.json()) as {
      data?: Array<{
        name?: string;
        status?: string;
        capabilities?: { sending?: string };
      }>;
    };
    const domain = result.data?.find(
      (item) =>
        item.name &&
        item.capabilities?.sending === "enabled" &&
        ["verified", "partially_verified", "partially_failed"].includes(
          item.status ?? ""
        )
    );
    discoveredSender = domain?.name
      ? `Opulence Bliss <no-reply@${domain.name}>`
      : null;
    return discoveredSender;
  } catch (error) {
    console.error("Could not inspect Resend domains:", error);
    discoveredSender = null;
    return null;
  }
}

async function deliverWithSender(
  key: string,
  sender: string,
  opts: {
    to: string;
    subject: string;
    title: string;
    body: string;
    cta?: { text: string; url: string };
    idempotencyKey?: string;
  }
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": "opulence-bliss/1.0",
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: sender,
      to: [opts.to],
      subject: opts.subject,
      html: wrap(opts.title, opts.body, opts.cta),
    }),
  });
  if (response.ok) return { ok: true as const };

  const responseBody = await response.text();
  console.error("Resend error:", response.status, responseBody);
  return {
    ok: false as const,
    reason: deliveryFailure(response.status, responseBody),
  };
}

export async function sendEmail(opts: {
  to: string | null | undefined;
  subject: string;
  title: string;
  body: string;
  cta?: { text: string; url: string };
  idempotencyKey?: string;
}) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !opts.to) {
    console.error("Email delivery skipped: RESEND_API_KEY or recipient is missing.");
    return { ok: false as const, reason: "not_configured" as const };
  }

  try {
    let lastFailure: { ok: false; reason: EmailFailureReason } | null = null;
    for (const sender of CONFIGURED_SENDERS) {
      const delivery = await deliverWithSender(key, sender, {
        ...opts,
        to: opts.to,
      });
      if (delivery.ok) return delivery;
      lastFailure = delivery;
      if (delivery.reason !== "sender_not_verified") return delivery;
    }

    const verifiedSender = await findVerifiedSender(key);
    if (verifiedSender && !CONFIGURED_SENDERS.includes(verifiedSender)) {
      return await deliverWithSender(key, verifiedSender, {
        ...opts,
        to: opts.to,
      });
    }
    return lastFailure ?? { ok: false as const, reason: "delivery_failed" as const };
  } catch (e) {
    console.error("Email failed:", e);
    return { ok: false as const, reason: "delivery_failed" as const };
  }
}
