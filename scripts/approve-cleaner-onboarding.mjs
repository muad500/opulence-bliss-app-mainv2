import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

// The owner confirmed the effective date, not an earlier approval date.
// Store receipt separately; never backdate evidence. This tool never enables a feature,
// writes a database or sends mail. Original review wording stays immutable.
const date = process.argv
  .find((arg) => arg.startsWith("--effective="))
  ?.slice(12);
const recordedOn = process.argv
  .find((arg) => arg.startsWith("--recorded-on="))
  ?.slice(14);
if (
  !date ||
  !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
  !recordedOn ||
  !/^\d{4}-\d{2}-\d{2}$/.test(recordedOn) ||
  !process.argv.includes("--as-written")
)
  throw Error(
    "Supply the confirmed effective date, receipt date and --as-written.",
  );
const file = "content/cleaner-onboarding-drafts.json";
const original = readFileSync(file, "utf8");
const catalog = JSON.parse(original);
if (catalog.version !== "draft-1" || catalog.status !== "draft")
  throw Error("Only draft-1 can be approved with this operation.");
mkdirSync("content/history", { recursive: true });
const archive = "content/history/cleaner-onboarding-draft-1.json";
if (existsSync(archive) && readFileSync(archive, "utf8") !== original)
  throw Error("The archived draft-1 source differs.");
writeFileSync(archive, original, { flag: existsSync(archive) ? "w" : "wx" });
catalog.version = "1.0";
catalog.status = "approved";
catalog.statusLabel = "Version 1.0 – effective 1 October 2026";
catalog.title = "Cleaner onboarding: approved emails and staff checklist";
catalog.purpose =
  "Approved operational wording from review draft-1. Publication is separate from delivery and activation: guarded Stage 2 flows and their readiness checks still apply.";
catalog.approval = {
  version: "1.0",
  effectiveDate: date,
  recordedOn,
  approvedBy: "Opulence Bliss",
  reviewedVersion: "draft-1",
  amendments: "None",
  reviewedSourceSha256: createHash("sha256").update(original).digest("hex"),
};
for (const item of [
  ...catalog.emails,
  ...catalog.declarations,
  ...catalog.checklists,
]) {
  item.approval = { ...catalog.approval };
  item.statusLabel = catalog.statusLabel;
}
writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
console.log(
  "Recorded approval for E01–E10, D01 and C01–C12; draft-1 archived. No remote changes.",
);
