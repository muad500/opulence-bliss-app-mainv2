"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CLEANER_ASSESSMENT_COPY as copy } from "@/lib/cleanerAssessmentPolicy";
import styles from "./screen.module.css";

type Snapshot = {
  attemptId: string;
  phase:
    | "questions"
    | "writing"
    | "writing_review"
    | "manager_review"
    | "failed"
    | "ended"
    | "passed";
  position?: number;
  prompt?: string;
  choices?: { id: string; text: string }[];
  deadline?: string;
  serverTime: string;
  writing?: string;
  reviewStage?: "writing" | "assessment";
};
const endpoint = "/api/cleaner-assessment/session";
const marker = "opulence-cleaner-active-assessment";
const active = (value: Snapshot | null) =>
  value?.phase === "questions" || value?.phase === "writing";

export default function CleanerAssessment() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState("");
  const [clock, setClock] = useState(0);
  const [wakeNotice, setWakeNotice] = useState("");
  const current = useRef<Snapshot | null>(null);
  const writingRef = useRef("");
  const [clockOffset, setClockOffset] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const entryCleanup = useRef<Promise<void>>(Promise.resolve());
  const terminating = useRef(false);
  const phase = snapshot?.phase;
  const attemptId = snapshot?.attemptId;

  const apply = useCallback((next: Snapshot) => {
    if (terminating.current && active(next)) return;
    const enteringWriting = current.current?.phase !== "writing";
    current.current = next;
    setClockOffset(Date.parse(next.serverTime) - Date.now());
    setSnapshot(next);
    setClock(Date.now());
    if (
      next.phase === "writing" &&
      enteringWriting &&
      next.writing !== undefined
    ) {
      writingRef.current = next.writing;
      setWriting(next.writing);
    }
    if (active(next)) sessionStorage.setItem(marker, next.attemptId);
    else sessionStorage.removeItem(marker);
  }, []);

  const send = useCallback(
    (action: string, extra: Record<string, unknown> = {}) => {
      const attemptId = current.current?.attemptId;
      if (!attemptId) return Promise.resolve();
      // Serialise heartbeat/answer/save requests so a delayed heartbeat cannot
      // overwrite the next question or the applicant's latest typing.
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          const result = await fetch(endpoint, {
            method: "PATCH",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attemptId, action, ...extra }),
          });
          const data = await result.json();
          if (result.status === 401) {
            terminating.current = true;
            apply({ ...current.current!, phase: "ended" });
          }
          if (!result.ok)
            throw Error(
              data.error ??
                "The connection was interrupted. Please tell the host.",
            );
          apply(data);
          setError("");
        })
        .catch((problem) => {
          setError(
            problem instanceof Error
              ? problem.message
              : "Please tell the host about this problem.",
          );
        });
      return queue.current;
    },
    [apply],
  );

  useEffect(() => {
    // Reload/back/restore must not silently resume an in-progress attempt.
    const previous = sessionStorage.getItem(marker);
    if (previous) {
      terminating.current = true;
      entryCleanup.current = fetch(endpoint, {
        method: "PATCH",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: previous, action: "page_left" }),
      })
        .then(async (response) => {
          if (response.ok) apply(await response.json());
          else
            setError("This assessment session has ended. Please ask the host.");
        })
        .catch(() =>
          setError("This assessment session has ended. Please ask the host."),
        );
      sessionStorage.removeItem(marker);
    }
  }, [apply]);

  useEffect(() => {
    if (!phase || phase === "failed" || phase === "passed" || phase === "ended")
      return;
    const heartbeat = setInterval(() => {
      if (!terminating.current)
        void send(
          current.current?.phase === "writing" ? "writing_save" : "heartbeat",
          current.current?.phase === "writing"
            ? { writing: writingRef.current }
            : {},
        );
    }, 2000);
    const countdown = setInterval(() => setClock(Date.now()), 250);
    const leave = () => {
      if (!active(current.current) || terminating.current) return;
      terminating.current = true;
      // Send immediately, not behind queued requests. The server transaction
      // handles concurrent final heartbeat/answer events without restoring it.
      void fetch(endpoint, {
        method: "PATCH",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId: current.current?.attemptId,
          action: "page_left",
        }),
      })
        .then(async (response) => {
          if (response.ok) apply(await response.json());
        })
        .catch(() => {});
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") leave();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    window.addEventListener("popstate", leave);
    return () => {
      clearInterval(heartbeat);
      clearInterval(countdown);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("popstate", leave);
    };
  }, [phase, attemptId, send, apply]);

  useEffect(() => {
    if (phase !== "questions" && phase !== "writing") return;
    let released = false;
    let sentinel: WakeLockSentinel | undefined;
    if ("wakeLock" in navigator)
      void navigator.wakeLock
        .request("screen")
        .then((lock) => {
          if (released) void lock.release();
          else sentinel = lock;
        })
        .catch(() =>
          setWakeNotice(
            "Keep your screen awake. Your device could not enable screen wake lock.",
          ),
        );
    else
      Promise.resolve().then(() =>
        setWakeNotice(
          "Keep your screen awake; do not lock your phone or computer.",
        ),
      );
    return () => {
      released = true;
      if (sentinel) void sentinel.release();
    };
  }, [phase]);

  async function start() {
    if (active(current.current)) return;
    setBusy(true);
    setError("");
    try {
      // Finish the old attempt's page-leave request before exchanging a fresh
      // invitation. Only the server can authorise a Manager's single reopening.
      await entryCleanup.current;
      const invitation = new URLSearchParams(window.location.hash.slice(1)).get(
        "invitation",
      );
      if (!invitation)
        throw Error(
          "Open the private invitation supplied by your induction host.",
        );
      terminating.current = false;
      const result = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitation, rulesAccepted: accepted }),
      });
      const data = await result.json();
      if (!result.ok) throw Error(data.error);
      window.history.replaceState(null, "", window.location.pathname);
      apply(data);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Please ask the host.",
      );
    } finally {
      setBusy(false);
    }
  }
  const remaining = snapshot?.deadline
    ? Math.max(
        0,
        Math.ceil((Date.parse(snapshot.deadline) - clock - clockOffset) / 1000),
      )
    : null;
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.test}>
          STAGING TEST — assessment setup is not complete
        </p>
        <h1>Cleaner assessment</h1>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {!snapshot && (
          <>
            <ul>
              {copy.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              {copy.rulesCheckbox}
            </label>
            <button disabled={!accepted || busy} onClick={() => void start()}>
              Start assessment
            </button>
          </>
        )}
        {active(snapshot) && remaining !== null && (
          <p className={styles.timer} aria-live="off">
            {snapshot?.phase === "writing"
              ? copy.writingTimer.replace(
                  "{n}",
                  String(Math.ceil(remaining / 60)),
                )
              : copy.questionTimer.replace("{n}", String(remaining))}{" "}
            {snapshot?.phase === "questions" &&
              `· Question ${snapshot.position} of 15`}
          </p>
        )}
        {wakeNotice && active(snapshot) && <p>{wakeNotice}</p>}
        {snapshot?.phase === "questions" && (
          <>
            <h2>{snapshot.prompt}</h2>
            <div className={styles.choices}>
              {snapshot.choices?.map((choice) => (
                <button
                  key={choice.id}
                  disabled={busy || remaining === 0}
                  onClick={async () => {
                    setBusy(true);
                    await send("answer", {
                      position: snapshot.position,
                      choice: choice.id,
                    });
                    setBusy(false);
                  }}
                >
                  {choice.text}
                </button>
              ))}
            </div>
          </>
        )}
        {snapshot?.phase === "writing" && (
          <>
            <h2>{snapshot.prompt}</h2>
            <p>{copy.writingInstruction}</p>
            <textarea
              aria-label="Your writing"
              rows={8}
              maxLength={6000}
              value={writing}
              onPaste={(event) => event.preventDefault()}
              onDrop={(event) => event.preventDefault()}
              onBeforeInput={(event) => {
                if (
                  (event.nativeEvent as InputEvent).inputType ===
                  "insertFromPaste"
                )
                  event.preventDefault();
              }}
              onChange={(event) => {
                writingRef.current = event.target.value;
                setWriting(event.target.value);
              }}
            />
            <button
              disabled={busy || remaining === 0}
              onClick={async () => {
                setBusy(true);
                await send("writing_submit", { writing: writingRef.current });
                setBusy(false);
              }}
            >
              Submit writing
            </button>
          </>
        )}
        {snapshot?.phase === "writing_review" && (
          <p role="status">{copy.waiting}</p>
        )}
        {snapshot?.phase === "manager_review" && (
          <p role="status">
            {snapshot.reviewStage === "writing"
              ? copy.waiting
              : "Your assessment is awaiting a staff review. Please speak to the host."}
          </p>
        )}
        {snapshot?.phase === "failed" && (
          <>
            <h2>{copy.notPassed}</h2>
            <p>{copy.review}</p>
          </>
        )}
        {snapshot?.phase === "passed" && (
          <>
            <h2>{copy.passed}</h2>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const response = await fetch(
                    "/api/cleaner-assessment/setup",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: "{}",
                    },
                  );
                  const result = await response.json();
                  if (!response.ok) throw Error(result.error);
                  window.location.assign(result.url);
                } catch (error) {
                  setError((error as Error).message);
                  setBusy(false);
                }
              }}
            >
              Continue to your account setup
            </button>
          </>
        )}
        {snapshot?.phase === "ended" && (
          <p role="status">
            This assessment session has ended. Please ask the host.
          </p>
        )}
      </section>
    </main>
  );
}
