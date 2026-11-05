import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import prettier from "prettier";

const check = process.argv.includes("--check");
const catalog = JSON.parse(
  readFileSync("content/cleaner-onboarding-drafts.json", "utf8"),
);
if (
  catalog.status !== "draft" ||
  catalog.statusLabel !== "Draft – awaiting client approval"
)
  throw Error("Only an explicitly unapproved draft catalog is supported.");
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
        wording: `[${entry.reference} – ${catalog.statusLabel}]`,
        status: "draft",
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
const module = { exports: {} };
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
  { module, exports: module.exports },
);
const markdown = await prettier.format(
  module.exports.renderCleanerOnboardingReview(catalog),
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
