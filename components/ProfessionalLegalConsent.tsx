"use client";
import { professionalConsentBoxes } from "@/lib/professionalLegalCopy";

const links = [
  [
    "Professional Partner Agreement",
    "/provider/join/policies/professional-partner-agreement",
  ],
  [
    "Cleaner Cancellation Policy",
    "/provider/join/policies/cleaner-cancellation",
  ],
  [
    "Handyman Terms and Conditions",
    "/provider/join/policies/handyman-professional-terms",
  ],
  [
    "Safeguarding, Lone Working and Incident Reporting Policy",
    "/provider/join/policies/safeguarding",
  ],
  ["DBS and Criminal-Offence Data Policy", "/provider/join/policies/dbs-data"],
  ["Privacy Notice", "/legal/privacy"],
] as const;
function LinkedCopy({ text }: { text: string }) {
  const link = links.find(([label]) => text.includes(label));
  if (!link) return <>{text}</>;
  const index = text.indexOf(link[0]);
  return (
    <>
      {text.slice(0, index)}
      <a href={link[1]} target="_blank" rel="noopener noreferrer">
        {link[0]}
      </a>
      <LinkedCopy text={text.slice(index + link[0].length)} />
    </>
  );
}
export default function ProfessionalLegalConsent({
  cleaning,
  handyman,
  value,
  onChange,
}: {
  cleaning: boolean;
  handyman: boolean;
  value: Record<string, boolean>;
  onChange: (value: Record<string, boolean>) => void;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: "24px 0" }}>
      <legend>Professional agreements</legend>
      <p>
        New policy declarations: Version 1.0 · Effective from: 1 October 2026.
        The current cleaner agreement keeps the version shown on its page.
      </p>
      {cleaning && (
        <p role="status">
          The current cleaner agreement applies to this application. When the
          new Cleaner Terms are published, we will ask you to accept them when
          you next sign in. The declarations below also apply.
        </p>
      )}
      {professionalConsentBoxes(cleaning, handyman).map((box) => (
        <label
          key={box.key}
          style={{
            display: "flex",
            alignItems: "start",
            gap: 12,
            padding: "12px 0",
            lineHeight: 1.6,
          }}
        >
          <input
            type="checkbox"
            required
            checked={value[box.key] === true}
            onChange={(event) =>
              onChange({ ...value, [box.key]: event.target.checked })
            }
            style={{ width: 22, height: 22, flexShrink: 0, marginTop: 3 }}
          />
          <span>
            <LinkedCopy text={box.text} />
          </span>
        </label>
      ))}
    </fieldset>
  );
}
