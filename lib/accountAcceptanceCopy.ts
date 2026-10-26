export const CUSTOMER_SIGNUP_ACCEPTANCE =
  "I have read and accept the Terms & Conditions, Privacy Policy and Cancellation & Refund Policy.";
export const GOOGLE_LOGIN_ACCEPTANCE =
  "By continuing, you agree to our Terms, Privacy Policy and Cancellation & Refund Policy.";
export const PROFESSIONAL_SIGNUP_ACCEPTANCE =
  "I have read and accept the Service Professional Partner Agreement and acknowledge the Privacy Policy.";
export function safeguardingAcceptance(version: string) {
  return `I have read and agree to follow the Safeguarding, Lone Working and Incident Reporting Policy (Version ${version}).`;
}
