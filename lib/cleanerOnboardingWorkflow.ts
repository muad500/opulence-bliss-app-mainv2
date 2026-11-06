import { CLEANER_ONBOARDING_MISSING_SOURCES } from "./cleanerOnboardingPlaceholders";

export const CLEANER_APPLICATION_STAGES = [
  { key: "screened", label: "Desk screening", source: "deskScreening" },
  { key: "interviewed", label: "Interview", source: "interviewCriteria" },
  {
    key: "id_rtw_verified",
    label: "Identity and right to work",
    source: "liveIdentityCheck",
  },
  { key: "dbs_recorded", label: "Basic DBS", source: null },
  { key: "experience_checked", label: "Experience", source: null },
] as const;

export type CleanerApplicationStage =
  (typeof CLEANER_APPLICATION_STAGES)[number]["key"];

export function cleanerStagePlaceholder(stage: CleanerApplicationStage) {
  const source = CLEANER_APPLICATION_STAGES.find(
    (item) => item.key === stage,
  )?.source;
  return source &&
    CLEANER_ONBOARDING_MISSING_SOURCES[source].status !== "approved"
    ? CLEANER_ONBOARDING_MISSING_SOURCES[source].wording
    : null;
}

export function parseOnboardingAction(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Choose an application action.");
  const input = value as Record<string, unknown>;
  if (
    typeof input.applicationId !== "string" ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.applicationId)
  )
    throw Error("Choose an application.");
  if (
    !["record", "complete", "escalate", "resolve", "reject"].includes(
      input.action as string,
    )
  )
    throw Error("Choose a valid application action.");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length < 10 || note.length > 2000)
    throw Error("Record a note of 10 to 2,000 characters.");
  const stage = CLEANER_APPLICATION_STAGES.find(
    (entry) => entry.key === input.stage,
  )?.key;
  if (["record", "complete"].includes(input.action as string) && !stage)
    throw Error("Choose an application stage.");
  const details = input.details ?? {};
  if (
    !details ||
    typeof details !== "object" ||
    Array.isArray(details) ||
    JSON.stringify(details).length > 6000
  )
    throw Error("Check the stage details.");
  return {
    applicationId: input.applicationId,
    action: input.action as
      | "record"
      | "complete"
      | "escalate"
      | "resolve"
      | "reject",
    stage: stage ?? null,
    note,
    details: details as Record<string, unknown>,
  };
}
