import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/adminSession";
import { cleanerOnboardingDraftReviewEnabled } from "@/lib/cleanerOnboardingDraftReview";
import { cleanerOnboardingDraftCatalog } from "@/lib/cleanerOnboardingDraftsServer";
import { onboardingDraftTokens } from "@/lib/cleanerOnboardingDraftFormat";
import styles from "./screen.module.css";

export const dynamic = "force-dynamic";
export default async function CleanerOnboardingDraftReview() {
  if (!cleanerOnboardingDraftReviewEnabled()) notFound();
  await requireAdminPage("onboarding");
  const catalog = cleanerOnboardingDraftCatalog();
  const entries = [
    ...catalog.emails,
    ...catalog.declarations,
    ...catalog.checklists,
  ];
  return (
    <main className={styles.page}>
      <p className={styles.badge}>{catalog.statusLabel}</p>
      <h1>{catalog.title}</h1>
      <p>{catalog.purpose}</p>
      <p>
        Review version {catalog.version} · Prepared {catalog.preparedOn}
      </p>
      <p>
        <Link href="/admin/onboarding">Professional onboarding</Link> ·{" "}
        <a href="/api/admin/cleaner-onboarding-drafts">Download review copy</a>
      </p>
      <section className={styles.card}>
        <h2>Complete inventory</h2>
        <ul>
          {entries.map((entry) => (
            <li key={entry.code}>
              <a href={`#${entry.code}`}>
                {entry.code}: {entry.title}
              </a>
            </li>
          ))}
        </ul>
        <p>
          Review only. No email is sent and no application decision is recorded
          here.
        </p>
      </section>
      <section className={styles.card}>
        <h2>Review notes</h2>
        <ul>
          {catalog.reviewNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
      <h2>Proposed emails</h2>
      {catalog.emails.map((draft) => (
        <section key={draft.id} id={draft.code} className={styles.card}>
          <p className={styles.badge}>{catalog.statusLabel}</p>
          <h3>
            {draft.code}: {draft.title}
          </h3>
          <p>
            <strong>Audience:</strong> {draft.audience}
          </p>
          <p>
            <strong>Trigger:</strong> {draft.trigger}
          </p>
          <p>
            <strong>Subject:</strong> {draft.subject}
          </p>
          <blockquote>
            {draft.paragraphs.map((paragraph, index) => (
              <p className={styles.copy} key={index}>
                {paragraph}
              </p>
            ))}
          </blockquote>
          <p>
            <strong>Merge fields:</strong>{" "}
            {onboardingDraftTokens(draft.subject, draft.paragraphs).join(", ")}
          </p>
          <p>
            <strong>Reference:</strong> {draft.reference}
          </p>
          <p>
            <strong>Basis:</strong> {draft.basis.join("; ")}
          </p>
          <ul>
            {draft.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
      <h2>Proposed acknowledgement</h2>
      {catalog.declarations.map((draft) => (
        <section key={draft.id} id={draft.code} className={styles.card}>
          <p className={styles.badge}>{catalog.statusLabel}</p>
          <h3>
            {draft.code}: {draft.title}
          </h3>
          <blockquote>{draft.wording}</blockquote>
          <p>
            <strong>Reference:</strong> {draft.reference}
          </p>
          <p>
            <strong>Basis:</strong> {draft.basis.join("; ")}
          </p>
          <ul>
            {draft.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
      <h2>Proposed staff checklist</h2>
      <p>
        These review boxes are disabled. They do not change the existing
        activation requirements or record a completed check.
      </p>
      {catalog.checklists.map((draft) => (
        <section key={draft.id} id={draft.code} className={styles.card}>
          <p className={styles.badge}>{catalog.statusLabel}</p>
          <h3>
            {draft.code}: {draft.title}
          </h3>
          <ul className={styles.checks}>
            {draft.items.map((item) => (
              <li key={item.id}>
                <label>
                  <input type="checkbox" disabled /> <span>{item.text}</span>
                </label>
              </li>
            ))}
          </ul>
          <p>
            <strong>Reference:</strong> {draft.reference}
          </p>
          <p>
            <strong>Basis:</strong> {draft.basis.join("; ")}
          </p>
          <ul>
            {draft.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
      <section className={styles.card}>
        <h2>Existing wording kept unchanged</h2>
        {catalog.unchangedTemplates.map((item) => (
          <div key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.reference}</p>
            <p>{item.note}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
