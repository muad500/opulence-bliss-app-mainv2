import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import prettier from "prettier";

const check = process.argv.includes("--check");
const catalog = JSON.parse(
  readFileSync("content/cleaner-onboarding-drafts.json", "utf8"),
);
if (!["draft", "approved"].includes(catalog.status))
  throw Error("Unsupported catalog state.");
if (catalog.status === "approved") {
  const archived = readFileSync(
    "content/history/cleaner-onboarding-draft-1.json",
    "utf8",
  );
  const before = JSON.parse(archived);
  if (
    catalog.approval?.reviewedVersion !== "draft-1" ||
    catalog.approval?.approvedBy !== "Opulence Bliss" ||
    catalog.approval?.effectiveDate !== "2026-10-01" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(catalog.approval?.recordedOn ?? "") ||
    createHash("sha256").update(archived).digest("hex") !==
      catalog.approval.reviewedSourceSha256
  )
    throw Error("Dated approval and exact draft-1 history are required.");
  for (const key of ["emails", "declarations", "checklists"]) {
    const withoutApproval = catalog[key].map((entry) =>
      Object.fromEntries(
        Object.entries(entry).filter(
          ([key]) => !["approval", "statusLabel"].includes(key),
        ),
      ),
    );
    if (JSON.stringify(withoutApproval) !== JSON.stringify(before[key]))
      throw Error("Approved wording differs from the as-written review.");
    if (
      catalog[key].some(
        (item) =>
          JSON.stringify(item.approval) !== JSON.stringify(catalog.approval) ||
          item.statusLabel !== catalog.statusLabel,
      )
    )
      throw Error("Every item needs its approval record.");
  }
}
const entries = [
  ...catalog.emails,
  ...catalog.declarations,
  ...catalog.checklists,
];
for (const property of ["id", "code"])
  if (new Set(entries.map((item) => item[property])).size !== entries.length)
    throw Error("Draft identifiers must be unique.");
if (
  entries.some(
    (entry) =>
      !entry.title || !entry.reference || !entry.basis?.length || !entry.notes,
  )
)
  throw Error("Each draft requires a source basis and review notes.");
const legal = JSON.parse(readFileSync("lib/finalLegalPack.json", "utf8"));
for (const source of catalog.sources.filter((source) => source.contentMd5)) {
  const document = legal[source.id];
  if (
    !document ||
    document.version !== source.version ||
    createHash("md5").update(document.contentHtml).digest("hex") !==
      source.contentMd5
  )
    throw Error(
      `Published source snapshot changed: ${source.id}. Re-review the drafts.`,
    );
}
const metadata = Object.fromEntries(
  entries
    .filter((entry) => entry.legacyKey)
    .map((entry) => [
      entry.legacyKey,
      {
        reference: entry.reference,
        kind: entry.kind,
        wording:
          catalog.status === "approved" && entry.wording
            ? entry.wording
            : `[${entry.reference} – ${catalog.statusLabel}]`,
        status: catalog.status,
        version: catalog.version,
      },
    ]),
);
const requiredLegacyKeys = [
  "applicationReceived",
  "applicationRejected",
  "inductionInvitation",
  "applicationNotice",
  "deskScreening",
  "interviewCriteria",
  "liveIdentityCheck",
  "managerEscalation",
  "firstJobFollowUp",
  "fifthJobReview",
];
if (
  Object.keys(metadata).sort().join("|") !== requiredLegacyKeys.sort().join("|")
)
  throw Error(
    "All ten earlier missing-source references must stay accounted for.",
  );
const source = await prettier.format(
  "// Generated review metadata only; edit content/cleaner-onboarding-drafts.json.\n" +
    "// Draft bodies/checklist items are staff-only and must not enter client bundles.\n" +
    `export const CLEANER_ONBOARDING_PENDING_SOURCES = ${JSON.stringify(metadata, null, 2)} as const;\n`,
  { parser: "typescript" },
);
const compiled = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync("lib/cleanerOnboardingDraftFormat.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { module: compiled, exports: compiled.exports },
);
const markdown = await prettier.format(
  compiled.exports.renderCleanerOnboardingReview(catalog),
  { parser: "markdown", proseWrap: "preserve" },
);
for (const [file, content] of [
  ["lib/cleanerOnboardingDraftMetadata.ts", source],
  ["docs/cleaner-onboarding-client-review.md", markdown],
]) {
  if (check) {
    if (readFileSync(file, "utf8").replaceAll("\r\n", "\n") !== content)
      throw Error(`Generated review file differs: ${file}`);
  } else writeFileSync(file, content);
}
console.log(
  JSON.stringify({
    mode: check ? "checked" : "prepared",
    status: catalog.status,
    emails: catalog.emails.length,
    declarations: catalog.declarations.length,
    checklistGroups: catalog.checklists.length,
    checklistItems: catalog.checklists.reduce(
      (total, group) => total + group.items.length,
      0,
    ),
  }),
);
