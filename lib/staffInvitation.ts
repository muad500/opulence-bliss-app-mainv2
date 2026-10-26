import { deploymentOrigins } from "./adminHosts";

export function staffInvitationEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
    ? email
    : null;
}

export function staffInvitationLink(
  token: string,
  env: Record<string, string | undefined>,
) {
  if (!/^[a-zA-Z0-9_-]{32,512}$/.test(token))
    throw new Error("Invalid staff invitation token.");
  const url = new URL("/staff/setup", deploymentOrigins(env).admin);
  url.searchParams.set("token_hash", token);
  return url.href;
}

export function pendingStaffInvitation(user: {
  last_sign_in_at?: string;
  app_metadata?: Record<string, unknown>;
}) {
  return (
    !user.last_sign_in_at &&
    typeof user.app_metadata?.staff_invited_by === "string"
  );
}
