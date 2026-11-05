import type {
  CleanerOnboardingDraftCatalog,
  OnboardingDraftBase,
} from "./cleanerOnboardingDraftTypes";

export function onboardingDraftTokens(subject: string, paragraphs: string[]) {
  return [
    ...new Set(
      (subject + "\n" + paragraphs.join("\n")).match(/\{\{[a-z_]+\}\}/g) ?? [],
    ),
  ];
}

/** A review artifact only. It contains no send/publish or approval operation. */
export function renderCleanerOnboardingReview(
  catalog: CleanerOnboardingDraftCatalog,
) {
  const lines = [
    "<!-- Generated from content/cleaner-onboarding-drafts.json. Edit that file, then regenerate. -->",
    `# ${catalog.title}`,
    "",
    `**${catalog.statusLabel}**`,
    "",
    `Review version: ${catalog.version} | Prepared: ${catalog.preparedOn}`,
    "",
    catalog.purpose,
    "",
    "## Client approval record",
    "",
    "Decision: approve as written / approve with amendments / request changes",
    "",
    "Approved item codes and version: ____________________",
    "",
    "Client name and date: ____________________",
    "",
    "Recording approval in this review copy does not enable a website feature or send a message. Approved wording must be versioned and connected to the guarded workflow separately.",
    "",
    "## Complete inventory",
    "",
    "| Code | Draft | Replaces / source reference |",
    "| --- | --- | --- |",
    ...[...catalog.emails, ...catalog.declarations, ...catalog.checklists].map(
      (d) => `| ${d.code} | ${d.title} | ${d.reference} |`,
    ),
    "",
    "## Scope and implementation notes",
    "",
    ...catalog.reviewNotes.map((note) => `- ${note}`),
    "",
    "## Source documents",
    "",
    ...catalog.sources.map(
      (source) =>
        `- ${source.title}, v${source.version}, effective ${source.effectiveDate}.`,
    ),
    "",
    "## Proposed emails",
    "",
  ];
  function heading(draft: OnboardingDraftBase) {
    lines.push(
      `### ${draft.code}. ${draft.title}`,
      "",
      `**${catalog.statusLabel}**`,
      "",
      `Reference: ${draft.reference}`,
      "",
      `Basis: ${draft.basis.join("; ")}`,
      "",
    );
  }
  function notes(draft: OnboardingDraftBase) {
    if (draft.notes.length)
      lines.push(
        "Reviewer notes:",
        "",
        ...draft.notes.map((note) => `- ${note}`),
        "",
      );
  }
  for (const draft of catalog.emails) {
    heading(draft);
    lines.push(
      `Audience: ${draft.audience}`,
      "",
      `Trigger: ${draft.trigger}`,
      "",
      `**Subject: ${draft.subject}**`,
      "",
      ...draft.paragraphs.flatMap((paragraph) => [paragraph, ""]),
      `Merge fields: ${onboardingDraftTokens(draft.subject, draft.paragraphs).join(", ") || "None"}`,
      "",
    );
    notes(draft);
  }
  lines.push("## Proposed application acknowledgement", "");
  for (const draft of catalog.declarations) {
    heading(draft);
    lines.push(draft.wording, "");
    notes(draft);
  }
  lines.push(
    "## Proposed staff checklist",
    "",
    "Every completed item in the eventual approved workflow must record the staff member, UTC time and any necessary note. Sensitive evidence stays in the restricted record. These review checkboxes are not live application decisions.",
    "",
  );
  for (const draft of catalog.checklists) {
    heading(draft);
    lines.push(...draft.items.map((item) => `- [ ] ${item.text}`), "");
    notes(draft);
  }
  lines.push("## Existing wording kept unchanged", "");
  for (const item of catalog.unchangedTemplates)
    lines.push(
      `### ${item.title}`,
      "",
      `Reference: ${item.reference}`,
      "",
      item.note,
      "",
    );
  return lines.join("\n").trimEnd() + "\n";
}
