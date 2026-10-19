export function hasStaffTotpSession(
  claims: { aal?: unknown; amr?: unknown } | null | undefined,
  factors:
    | readonly { factor_type?: string; status?: string }[]
    | null
    | undefined,
) {
  return (
    claims?.aal === "aal2" &&
    Array.isArray(claims.amr) &&
    claims.amr.some((entry) => entry?.method === "totp") &&
    factors?.some(
      (factor) => factor.factor_type === "totp" && factor.status === "verified",
    ) === true
  );
}
