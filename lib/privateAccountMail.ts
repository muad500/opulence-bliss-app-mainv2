import "server-only";

export function accountMailReady() {
  const from =
    process.env.ACCOUNT_EMAIL_FROM ??
    process.env.BOOKING_EMAIL_FROM ??
    process.env.EMAIL_FROM;
  return (
    !!process.env.RESEND_API_KEY &&
    !!from &&
    /@(?:[a-z0-9-]+\.)*opulencebliss\.com>?$/i.test(from)
  );
}

/** Never log the body or provider response: setup links and verification codes are private. */
export async function sendPrivateAccountMail(
  to: string,
  subject: string,
  text: string,
  idempotencyKey: string,
) {
  if (!accountMailReady()) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from:
          process.env.ACCOUNT_EMAIL_FROM ??
          process.env.BOOKING_EMAIL_FROM ??
          process.env.EMAIL_FROM,
        to: [to],
        subject,
        text,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
