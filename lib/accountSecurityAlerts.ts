export const ACCOUNT_CHANGE_SUBJECT =
  "Your Opulence Bliss account details were changed";
export const ACCOUNT_CHANGE_MESSAGE =
  "Your Opulence Bliss account details were changed. If this wasn't you, contact hello@opulencebliss.com.";

/** Staging mail must never reach unrelated accounts copied from production. */
export function securityMailRecipientAllowed(
  email: string,
  env: Record<string, string | undefined>,
) {
  if (
    env.NEXT_PUBLIC_SUPABASE_URL?.includes("comwdjprdedmsnxtvuuk") ||
    env.VERCEL_ENV === "preview"
  ) {
    return (env.STAGING_EMAIL_RECIPIENTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.toLowerCase());
  }
  return true;
}

export function stripePayoutAccountChanged(
  type: string,
  previous: Record<string, unknown> | undefined,
) {
  if (
    [
      "account.external_account.created",
      "account.external_account.updated",
      "account.external_account.deleted",
    ].includes(type)
  )
    return true;
  if (type !== "account.updated" || !previous) return false;
  const settings = previous.settings as { payouts?: unknown } | undefined;
  return (
    "external_accounts" in previous || (!!settings && "payouts" in settings)
  );
}
