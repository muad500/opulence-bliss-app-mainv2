import "server-only";
import { createHash, createHmac } from "node:crypto";
import { cleanerStage2Enabled } from "./cleanerApplication";

export const decisionCookie = "__Host-opulence-cleaner-decision";
export const hashOnboardingAccess = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const validOnboardingAccess = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

// An isolated, personal capability: unrelated to Auth, staff or job tokens.
// Derive it only on the server, so asynchronous mail retries need no raw token
// in a table. Changing purpose/expiry produces an unrelated credential.
export function onboardingAccess(
  application: string,
  purpose: "decision" | "induction",
  expires: string,
) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cleanerStage2Enabled() || !secret)
    throw Error("Staging access unavailable.");
  return createHmac("sha256", secret)
    .update(`cleaner-stage2:${purpose}:${application}:${expires}`)
    .digest("hex");
}
