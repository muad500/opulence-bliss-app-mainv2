"use client";
import { useEffect, useState } from "react";
type Evidence = {
  tasks: string[];
  scope_confirmed_at: string | null;
  hazards_reviewed_at: string | null;
  hazard_note: string | null;
  photo_note: string | null;
  finished_at: string | null;
  completed_tasks: Record<string, { result: string; reason?: string }>;
};
type Photo = { id: string; stage: string };

export default function CleaningJobChecklist({
  bookingId,
  inProgress,
}: {
  bookingId: string;
  inProgress: boolean;
}) {
  const [evidence, setEvidence] = useState<Evidence | null>(null),
    [photos, setPhotos] = useState<Photo[]>([]);
  const [scope, setScope] = useState(false),
    [hazards, setHazards] = useState(false),
    [hazardNote, setHazardNote] = useState(""),
    [photoNote, setPhotoNote] = useState("");
  const [tasks, setTasks] = useState<Evidence["completed_tasks"]>({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/api/account/work-evidence/${bookingId}`;
  async function load() {
    const response = await fetch(base),
      result = await response.json();
    if (!response.ok) {
      setMessage(result.error);
      return;
    }
    setEvidence(result.evidence);
    setPhotos(result.photos ?? []);
    if (result.evidence) {
      setScope(!!result.evidence.scope_confirmed_at);
      setHazards(!!result.evidence.hazards_reviewed_at);
      setHazardNote(result.evidence.hazard_note ?? "");
      setTasks(result.evidence.completed_tasks);
      setPhotoNote(result.evidence.photo_note ?? "");
    }
  }
  useEffect(() => {
    let active = true;
    fetch(base)
      .then((r) => r.json())
      .then((result) => {
        if (!active) return;
        setEvidence(result.evidence ?? null);
        setPhotos(result.photos ?? []);
        if (result.evidence) {
          setScope(!!result.evidence.scope_confirmed_at);
          setHazards(!!result.evidence.hazards_reviewed_at);
          setHazardNote(result.evidence.hazard_note ?? "");
          setTasks(result.evidence.completed_tasks);
          setPhotoNote(result.evidence.photo_note ?? "");
        }
        if (result.error) setMessage(result.error);
      })
      .catch(() => {
        if (active)
          setMessage("Checklist could not be loaded. Please refresh.");
      });
    return () => {
      active = false;
    };
  }, [base]);
  async function save(finish: boolean) {
    setBusy(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          hazards,
          hazardNote,
          tasks,
          photoNote,
          finish,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error);
      await load();
      setMessage(
        finish
          ? "Checklist saved. You can now check out."
          : "Before-work checklist saved.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined, stage: string) {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("stage", stage);
      const res = await fetch(`${base}/photos`, { method: "POST", body });
      const result = await res.json();
      if (!res.ok) throw Error(result.error);
      // Keep unsaved checklist edits when uploading a photo.
      const refreshed = await fetch(base).then((r) => r.json());
      setPhotos(refreshed.photos ?? []);
      setMessage("Photo added.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Photo upload failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!evidence) return message ? <p role="status">{message}</p> : null;
  return (
    <details
      style={{
        background: "#fff",
        border: "1px solid #ded5ec",
        borderRadius: 16,
        padding: 18,
        margin: "16px 0",
      }}
      open
    >
      <summary>
        <strong>Job checklist and work photos</strong>
      </summary>
      <p>
        Photograph the work only, never people, valuables or personal documents.
        If it is unsafe, leave and contact the team. Report damage or hazards
        before starting, and any incident the same day.
      </p>
      <fieldset
        disabled={busy || !!evidence.finished_at}
        style={{ border: 0, padding: 0, display: "grid", gap: 12 }}
      >
        <legend>Before starting</legend>
        <label>
          <input
            type="checkbox"
            checked={scope}
            onChange={(e) => setScope(e.target.checked)}
          />{" "}
          I confirmed the agreed scope and priorities with the customer or
          booking notes.
        </label>
        <label>
          <input
            type="checkbox"
            checked={hazards}
            onChange={(e) => setHazards(e.target.checked)}
          />{" "}
          I checked for pre-existing damage and hazards.
        </label>
        <label>
          Damage or hazards, if any
          <textarea
            maxLength={2000}
            value={hazardNote}
            onChange={(e) => setHazardNote(e.target.value)}
          />
        </label>
        <label>
          Before-work photo, where needed and safe
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void upload(e.target.files?.[0], "before")}
          />
        </label>
        {!inProgress && (
          <button
            type="button"
            disabled={!scope || !hazards}
            onClick={() => void save(false)}
          >
            Save before-work checklist
          </button>
        )}
        {inProgress && (
          <>
            <h4>Before checking out</h4>
            {evidence.tasks.map((task, i) => (
              <div key={i}>
                <label>
                  {task}
                  <select
                    value={tasks[i]?.result ?? ""}
                    onChange={(e) =>
                      setTasks({
                        ...tasks,
                        [i]: {
                          result: e.target.value,
                          reason: tasks[i]?.reason ?? "",
                        },
                      })
                    }
                  >
                    <option value="">Choose result</option>
                    <option value="done">Done</option>
                    <option value="not_applicable">
                      Not applicable / unable to complete
                    </option>
                  </select>
                </label>
                {tasks[i]?.result === "not_applicable" && (
                  <label>
                    Reason
                    <input
                      minLength={5}
                      maxLength={500}
                      value={tasks[i]?.reason ?? ""}
                      onChange={(e) =>
                        setTasks({
                          ...tasks,
                          [i]: { ...tasks[i], reason: e.target.value },
                        })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
            <label>
              Finished-work photo, where requested
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => void upload(e.target.files?.[0], "after")}
              />
            </label>
            <label>
              If no finished photo, explain why it was not requested or safe
              <textarea
                value={photoNote}
                maxLength={1000}
                onChange={(e) => setPhotoNote(e.target.value)}
              />
            </label>
            <button type="button" onClick={() => void save(true)}>
              Save completed checklist
            </button>
          </>
        )}
      </fieldset>
      {photos.length > 0 && (
        <p>
          {photos.map((photo, i) => (
            <a
              key={photo.id}
              href={`${base}/photos/${photo.id}`}
              target="_blank"
              rel="noreferrer"
              style={{ marginRight: 12 }}
            >
              {photo.stage === "before" ? "Before" : "Finished"} photo {i + 1}
            </a>
          ))}
        </p>
      )}
      {evidence.finished_at && <p>Checklist completed.</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
