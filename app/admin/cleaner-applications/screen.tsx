"use client";

import Link from "next/link";
import Evidence from "./evidence";
import { useEffect, useState, type FormEvent } from "react";
import { CLEANER_ONBOARDING_MISSING_SOURCES as sources } from "@/lib/cleanerOnboardingPlaceholders";
import {
  CLEANER_APPLICATION_STAGES,
  cleanerStagePlaceholder,
  type CleanerApplicationStage,
} from "@/lib/cleanerOnboardingWorkflow";
import styles from "../cleaner-assessment/screen.module.css";
import localStyles from "./screen.module.css";
import type { OnboardingChecklistDraft } from "@/lib/cleanerOnboardingDraftTypes";

type Summary = {
  id: string;
  full_name: string;
  status: string;
  manager_review: boolean;
  created_at: string;
};
type Detail = {
  checklist: {
    group_id: string;
    item_id: string;
    checked: boolean;
    actor: string;
    recorded_at: string;
    note: string;
  }[];
  application: Record<string, string> & { id: string; full_name: string };
  managerReview: boolean;
  stages: {
    stage: string;
    completed_at: string | null;
    recorded_at: string;
    details: Record<string, string | boolean>;
  }[];
  events: {
    id: number;
    created_at: string;
    actor: string;
    action: string;
    note: string;
  }[];
  communications: { template: keyof typeof sources; status: string }[];
};
const fields: Record<
  CleanerApplicationStage,
  { key: string; label: string; type?: string }[]
> = {
  screened: [{ key: "note", label: "Desk screening notes" }],
  interviewed: [
    { key: "notes", label: "Interview notes" },
    {
      key: "score",
      label: "Interview score (optional, no automatic pass mark)",
      type: "number",
    },
  ],
  id_rtw_verified: [
    { key: "checked_on", label: "GOV.UK check date", type: "date" },
    {
      key: "document_type",
      label: "Evidence type (never the full document number)",
    },
    { key: "outcome", label: "Outcome: verified or pending" },
    { key: "expires_on", label: "Permission expiry", type: "date" },
    { key: "no_expiry", label: "Permission has no expiry", type: "checkbox" },
    {
      key: "self_employment_permitted",
      label: "The checked permission allows self-employment",
      type: "checkbox",
    },
  ],
  dbs_recorded: [
    { key: "certificate_name", label: "Name on certificate" },
    { key: "certificate_number", label: "Basic DBS certificate number" },
    { key: "issue_date", label: "Issue date", type: "date" },
    { key: "outcome", label: "Outcome: clear or unspent_conviction" },
    { key: "review_on", label: "Review date", type: "date" },
  ],
  experience_checked: [
    { key: "evidence", label: "Reference or proof of experience" },
    {
      key: "manager_waiver",
      label: "Manager waives evidence (record the reason)",
      type: "checkbox",
    },
  ],
};

async function api(body?: unknown) {
  const response = await fetch("/api/admin/cleaner-applications", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? "Request failed.");
  return result;
}

export default function ApplicationConsole({
  checklists,
  wordingLabel,
}: {
  checklists: OnboardingChecklistDraft[];
  wordingLabel: string;
}) {
  const [rows, setRows] = useState<Summary[]>([]);
  const [record, setRecord] = useState<Detail | null>(null);
  const [stage, setStage] = useState<CleanerApplicationStage>("screened");
  const [privateOpen, setPrivateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Loading applications…");
  const [manager, setManager] = useState(false);
  const [tickNote, setTickNote] = useState("");
  async function arrange(
    event: FormEvent<HTMLFormElement>,
    action: "invite" | "publish_decision",
  ) {
    event.preventDefault();
    if (!record || busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (action === "invite")
      values.startsAt = new Date(String(values.startsAt) + "Z").toISOString();
    setBusy(true);
    try {
      await api({ ...values, action, applicationId: record.application.id });
      await open(record.application.id, privateOpen);
      setStatus(
        "Recorded. The scheduled worker will send to the approved test inbox only.",
      );
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function tick(group: string, item: string, checked: boolean) {
    if (!record || tickNote.trim().length < 10) {
      setStatus(
        "Record a factual note of at least 10 characters before changing a checklist item.",
      );
      return;
    }
    setBusy(true);
    try {
      await api({
        action: "checklist",
        applicationId: record.application.id,
        group,
        item,
        checked,
        note: tickNote,
      });
      await open(record.application.id, privateOpen);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const data = await api();
    setRows(data.applications ?? []);
    setManager(data.staffRole === "manager");
  }
  useEffect(() => {
    let mounted = true;
    api()
      .then((data) => {
        if (!mounted) return;
        setRows(data.applications ?? []);
        setManager(data.staffRole === "manager");
        setStatus("");
      })
      .catch(() => {
        if (mounted)
          setStatus("Applications could not be loaded. Refresh to retry.");
      });
    return () => {
      mounted = false;
    };
  }, []);
  async function open(id: string, includePrivate = false) {
    setBusy(true);
    setStatus("");
    // Do not leave the previous applicant's evidence on screen after a refused
    // opening or a Manager lock. No record is saved in browser storage.
    setRecord(null);
    setPrivateOpen(false);
    try {
      const result = await api({
        action: "open",
        applicationId: id,
        private: includePrivate,
      });
      setRecord(result.record);
      setPrivateOpen(includePrivate);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const button = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const action = button?.value ?? "record";
    const details = Object.fromEntries(
      fields[stage].map((field) => [
        field.key,
        field.type === "checkbox"
          ? data.get(field.key) === "on"
          : (data.get(field.key) ?? ""),
      ]),
    );
    setBusy(true);
    setStatus("");
    try {
      await api({
        applicationId: record.application.id,
        action,
        stage,
        details,
        note: data.get("note"),
      });
      setRecord(null);
      form.reset();
      await refresh();
      setStatus(
        "Recorded. Reopen the application to view its updated audit trail.",
      );
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const privateStage = ["id_rtw_verified", "dbs_recorded"].includes(stage);
  return (
    <main className={`${styles.page} ${localStyles.workspace}`}>
      <p className={styles.test}>STAGING ONLY. Use fictional test data.</p>
      <h1>Cleaner applications</h1>
      <p>
        <Link href="/admin/cleaner-assessment">
          Open the assessment console
        </Link>
      </p>
      <details className={styles.card}>
        <summary>Approved onboarding wording</summary>
        <ul>
          {Object.entries(sources).map(([key, entry]) => (
            <li key={key}>{entry.wording}</li>
          ))}
        </ul>
        <p>
          {wordingLabel}. Stage 2 emails are restricted to the approved staging
          test inbox.
        </p>
        <p>
          <Link href="/admin/cleaner-onboarding-drafts">
            Read or download the approved pack
          </Link>
        </p>
      </details>
      <p role="status" aria-live="polite">
        {busy ? "Saving or opening record…" : status}
      </p>
      <section aria-label="Application list" className={styles.card}>
        {rows.map((row) => (
          <article key={row.id}>
            <h2>{row.full_name}</h2>
            <p>
              {row.status}
              {row.manager_review ? " · Manager review" : ""} ·{" "}
              {new Date(row.created_at).toLocaleDateString("en-GB")}
            </p>
            <button disabled={busy} onClick={() => open(row.id)}>
              Open application
            </button>
          </article>
        ))}
        {!rows.length && !status && <p>No applications yet.</p>}
      </section>
      {record && (
        <section className={styles.card} aria-label="Application record">
          <h2>{record.application.full_name}</h2>
          <p>
            {record.application.email} · {record.application.phone} ·{" "}
            {record.application.status}
          </p>
          {record.application.provider_id && (
            <p>
              <Link href={`/admin/cleaners/${record.application.provider_id}`}>
                Open this professional&apos;s evidence and independent sign-off
              </Link>
            </p>
          )}
          {privateOpen &&
            record.application.provider_id &&
            ["assessment_passed", "accepted_setup"].includes(
              record.application.status,
            ) && <Evidence applicationId={record.application.id} />}
          {record.managerReview && <p>Locked for Manager review.</p>}
          <button
            disabled={busy}
            onClick={() => open(record.application.id, true)}
          >
            Open private identity and DBS evidence (named staff only)
          </button>
          <h3>Stage records</h3>
          <section aria-label="Approved onboarding checklist">
            <h3>Onboarding checklist</h3>
            <p>{wordingLabel} · Approved by Opulence Bliss</p>
            <label>
              Note for this checklist change
              <textarea
                value={tickNote}
                onChange={(event) => setTickNote(event.target.value)}
                minLength={10}
                maxLength={2000}
                rows={3}
              />
            </label>
            {checklists
              .filter(
                (group) =>
                  privateOpen ||
                  ![
                    "liveIdentityCheck",
                    "dbsReview",
                    "managerEscalation",
                  ].includes(group.id),
              )
              .map((group) => (
                <fieldset key={group.id} disabled={busy}>
                  <legend>
                    {group.code}: {group.title}
                  </legend>
                  {group.items.map((item) => {
                    const saved = record.checklist?.find(
                      (t) => t.group_id === group.id && t.item_id === item.id,
                    );
                    return (
                      <div key={item.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={saved?.checked ?? false}
                            onChange={(event) =>
                              tick(group.id, item.id, event.target.checked)
                            }
                          />
                          {item.text}
                        </label>
                        {saved && (
                          <p>
                            Recorded by {saved.actor} at{" "}
                            {new Date(saved.recorded_at).toLocaleString(
                              "en-GB",
                            )}{" "}
                            · {saved.note}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </fieldset>
              ))}
          </section>
          <ul>
            {record.stages.map((item) => (
              <li key={item.stage}>
                {item.stage}:{" "}
                {item.completed_at ? "Completed" : "Draft evidence recorded"} ·{" "}
                {new Date(item.recorded_at).toLocaleString("en-GB")}
                <dl>
                  {(fields[item.stage as CleanerApplicationStage] ?? []).map(
                    (field) => (
                      <div key={field.key}>
                        <dt>{field.label}</dt>
                        <dd>
                          {typeof item.details[field.key] === "boolean"
                            ? item.details[field.key]
                              ? "Yes"
                              : "No"
                            : item.details[field.key] || "Not recorded"}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </li>
            ))}
          </ul>
          <form onSubmit={act}>
            <label>
              Stage
              <select
                value={stage}
                onChange={(event) =>
                  setStage(event.target.value as CleanerApplicationStage)
                }
              >
                {CLEANER_APPLICATION_STAGES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {cleanerStagePlaceholder(stage) && (
              <p>{cleanerStagePlaceholder(stage)}</p>
            )}
            <fieldset
              disabled={busy || (privateStage && !privateOpen)}
              key={stage}
            >
              <legend>Record the known evidence fields</legend>
              {fields[stage].map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    name={field.key}
                    type={field.type ?? "text"}
                    maxLength={1500}
                  />
                </label>
              ))}
            </fieldset>
            <label>
              Reason or note
              <textarea
                name="note"
                minLength={10}
                maxLength={2000}
                rows={3}
                required
              />
            </label>
            <p>
              Keep offence details off the general file. Record only the
              outcome; a conviction needs a Manager decision.
            </p>
            <button
              value="record"
              disabled={busy || (privateStage && !privateOpen)}
            >
              Save evidence
            </button>
            <button
              value="complete"
              disabled={
                busy ||
                !!cleanerStagePlaceholder(stage) ||
                (privateStage && !privateOpen)
              }
            >
              Complete stage
            </button>
            <button value="escalate" disabled={busy}>
              Send to Manager and lock file
            </button>
            {manager && (
              <>
                <button value="resolve" disabled={busy}>
                  Resolve Manager review
                </button>
                <button value="reject" disabled={busy}>
                  Record rejection
                </button>
              </>
            )}
          </form>
          <h3>Communications</h3>
          {record.application.status === "experience_checked" && (
            <form onSubmit={(event) => arrange(event, "invite")}>
              <h3>Arrange induction and send personal access</h3>
              <label>
                Session start (UTC)
                <input type="datetime-local" name="startsAt" required />
              </label>
              <label>
                Google Meet address
                <input
                  type="url"
                  name="meetingUrl"
                  placeholder="https://meet.google.com/abc-defg-hij"
                  required
                />
              </label>
              <button disabled={busy}>Send induction invitation</button>
            </form>
          )}
          {manager && privateOpen && (
            <form onSubmit={(event) => arrange(event, "publish_decision")}>
              <h3>Secure DBS-related written decision</h3>
              <p>
                Named Manager only. Consider the applicant&apos;s explanation.
                No offence details will be copied into the email.
              </p>
              <label>
                Explanation considered
                <textarea
                  name="explanation"
                  minLength={10}
                  maxLength={4000}
                  required
                />
              </label>
              <label>
                Considered suitability decision
                <select name="suitability" required defaultValue="">
                  <option value="" disabled>
                    Choose a decision
                  </option>
                  <option value="suitable">
                    Suitable following Manager review
                  </option>
                  <option value="not_suitable">
                    Not suitable following Manager review
                  </option>
                </select>
              </label>
              <label>
                Decision shown to the applicant
                <textarea
                  name="decision"
                  minLength={10}
                  maxLength={4000}
                  required
                />
              </label>
              <label>
                Reasons shown privately to the applicant
                <textarea
                  name="reasons"
                  minLength={10}
                  maxLength={4000}
                  required
                />
              </label>
              <button disabled={busy}>Publish personal written decision</button>
            </form>
          )}
          <ul>
            {record.communications.map((item) => (
              <li key={item.template}>
                {sources[item.template]?.wording ?? item.template}:{" "}
                {item.status}
              </li>
            ))}
          </ul>
          <h3>Audit trail</h3>
          <ol>
            {record.events.map((item) => (
              <li key={item.id}>
                {new Date(item.created_at).toLocaleString("en-GB")} ·{" "}
                {item.actor} · {item.action}: {item.note}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
