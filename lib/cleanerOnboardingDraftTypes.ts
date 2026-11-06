export type OnboardingDraftBase = {
  approval?: OnboardingApproval;
  statusLabel?: string;
  id: string;
  code: string;
  title: string;
  reference: string;
  basis: string[];
  notes: string[];
  legacyKey?: string;
};
export type OnboardingApproval = {
  version: string;
  effectiveDate: string;
  recordedOn: string;
  approvedBy: string;
  reviewedVersion: string;
  amendments: string;
  reviewedSourceSha256: string;
};
export type OnboardingEmailDraft = OnboardingDraftBase & {
  kind: string;
  audience: string;
  trigger: string;
  subject: string;
  paragraphs: string[];
};
export type OnboardingDeclarationDraft = OnboardingDraftBase & {
  kind: string;
  audience: string;
  wording: string;
};
export type OnboardingChecklistDraft = OnboardingDraftBase & {
  kind: string;
  stage?: string;
  items: { id: string; text: string }[];
};
export type CleanerOnboardingDraftCatalog = {
  approval?: OnboardingApproval;
  version: string;
  status: string;
  statusLabel: string;
  preparedOn: string;
  title: string;
  purpose: string;
  reviewNotes: string[];
  sources: {
    id: string;
    title: string;
    version: string;
    effectiveDate: string;
    contentMd5?: string;
  }[];
  emails: OnboardingEmailDraft[];
  declarations: OnboardingDeclarationDraft[];
  checklists: OnboardingChecklistDraft[];
  unchangedTemplates: { title: string; reference: string; note: string }[];
};
