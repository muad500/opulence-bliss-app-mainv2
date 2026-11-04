export function documentChangeAcceptance(title: string, version: string) {
  return `I have read and accept ${title} (Version ${version}).`;
}
export function customerNoticeReady(
  sentAt: string | null,
  effectiveAt: string,
) {
  return (
    sentAt !== null &&
    Date.parse(effectiveAt) - Date.parse(sentAt) >= 30 * 86400000
  );
}
export type DocumentUpdate = {
  id: string;
  document_slug: string;
  version: string;
  title: string;
  summary: string;
  source_content_html: string;
  content_hash: string;
  pdf_path: string;
  pdf_sha256: string;
  effective_at: string;
};
export function documentChangeMail(
  plan: {
    title: string;
    version: string;
    summary: string;
    effective_at: string;
  },
  link: string,
) {
  return `${plan.title} is changing\n\nVersion ${plan.version} takes effect on ${new Date(plan.effective_at).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" })}.\n\nWhat is changing\n${plan.summary}\n\nRead the notice and the approved document: ${link}\n\nYou will be asked to accept the updated documents when you next book after the change takes effect. Your existing bookings keep their accepted terms.\n\nQuestions? Email hello@opulencebliss.com.`;
}
