"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { COMING_SOON, type ComingSoonKey } from "@/lib/comingSoon";
import styles from "./ServicePoll.module.css";

type Props = {
  /** The dropdown only loads the saved vote once opened. */
  enabled?: boolean;
  /** "compact" for the header dropdown, "page" for /coming-soon. */
  variant?: "compact" | "page";
};

type PollResult = {
  count: number;
  percent: number;
};

type PollResultRow = {
  service_key: string;
  vote_count: number | string;
  vote_percent: number | string;
  total_votes: number | string;
};

function normaliseResults(rows: unknown): {
  byKey: Partial<Record<ComingSoonKey, PollResult>>;
  total: number;
} {
  const byKey: Partial<Record<ComingSoonKey, PollResult>> = {};
  let total = 0;

  if (!Array.isArray(rows)) return { byKey, total };

  for (const raw of rows as PollResultRow[]) {
    if (!COMING_SOON.some((service) => service.key === raw.service_key)) {
      continue;
    }

    const key = raw.service_key as ComingSoonKey;
    byKey[key] = {
      count: Number(raw.vote_count) || 0,
      percent: Number(raw.vote_percent) || 0,
    };
    total = Number(raw.total_votes) || total;
  }

  return { byKey, total };
}

export default function ServicePoll({
  enabled = true,
  variant = "compact",
}: Props) {
  // The dropdown is a shortcut, not a landing page: the full descriptions
  // live on /coming-soon, so the compact variant shows titles only.
  const compact = variant === "compact";
  const [selected, setSelected] = useState<ComingSoonKey | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Signed in, but on an account that the database will not accept a vote
  // from. Knowing this up front avoids offering a control that always fails.
  const [notClient, setNotClient] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [results, setResults] = useState<
    Partial<Record<ComingSoonKey, PollResult>>
  >({});
  const [totalVotes, setTotalVotes] = useState(0);

  useEffect(() => {
    if (!enabled || loaded) return;
    let active = true;

    async function loadVote() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;
      if (!user) {
        setSignedOut(true);
        setLoaded(true);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;
      if (!profile || profile.role === "admin") {
        setNotClient(true);
        setLoaded(true);
        return;
      }

      const { data } = await supabase.rpc("my_customer_service_interest");
      if (!active) return;
      const vote = Array.isArray(data) ? data[0] : null;
      // A key retired from the poll would not match any radio; ignore it
      // rather than leaving the form in an unselectable state.
      if (
        vote?.service_key &&
        COMING_SOON.some((s) => s.key === vote.service_key)
      ) {
        setSelected(vote.service_key as ComingSoonKey);
        setHasVoted(true);

        const { data: resultRows } = await supabase.rpc(
          "customer_service_poll_results",
        );
        if (!active) return;
        const nextResults = normaliseResults(resultRows);
        setResults(nextResults.byKey);
        setTotalVotes(nextResults.total);
      }
      if (vote?.suggestion) setSuggestion(vote.suggestion);
      setLoaded(true);
    }

    void loadVote();
    return () => {
      active = false;
    };
  }, [enabled, loaded]);

  async function refreshResults() {
    const supabase = createClient();
    const { data } = await supabase.rpc("customer_service_poll_results");
    const nextResults = normaliseResults(data);
    setResults(nextResults.byKey);
    setTotalVotes(nextResults.total);
  }

  async function submitVote(
    serviceKey: ComingSoonKey | null = selected,
    successMessage = "Thanks, your vote has been saved.",
  ) {
    if (notClient) return;
    if (!serviceKey) {
      setMessage("Choose the service you would most like us to add.");
      return;
    }

    setSelected(serviceKey);
    setLoading(true);
    setMessage(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSignedOut(true);
      setMessage("Sign in to save your vote.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.rpc("submit_customer_service_interest", {
      p_service_key: serviceKey,
      p_suggestion: suggestion.trim() || null,
    });

    if (error) {
      setLoading(false);
      setSaved(false);
      setMessage(error.message);
      return;
    }

    setSignedOut(false);
    setHasVoted(true);
    await refreshResults();
    setLoading(false);
    setSaved(true);
    setMessage(successMessage);
  }

  return (
    <div className={`${styles.poll} ${styles[variant]}`}>
      <div className={styles.heading}>
        {!compact && (
          <span className={styles.eyebrow}>Help shape what comes next</span>
        )}
        <p className={styles.title}>
          Which of these services would you like us to add?
        </p>
        {!compact && (
          <p className={styles.sub}>
            Pick one, and add an idea of your own if you have one.
          </p>
        )}
      </div>

      <div className={styles.formPanel}>
        <fieldset
          className={`${styles.options} ${notClient ? styles.readOnly : ""}`}
          disabled={notClient}
        >
          <legend className={styles.srOnly}>Choose a future service</legend>
          {COMING_SOON.map(({ key, title, detail }) => {
            const checked = selected === key;
            const result = results[key] ?? { count: 0, percent: 0 };
            return (
              <label
                className={`${styles.option} ${checked ? styles.optionOn : ""} ${
                  hasVoted ? styles.optionWithResults : ""
                }`}
                key={key}
              >
                {hasVoted && (
                  <span
                    className={styles.resultBar}
                    style={{ width: `${result.percent}%` }}
                    aria-hidden="true"
                  />
                )}
                <input
                  type="radio"
                  name={`future-service-${variant}`}
                  value={key}
                  checked={checked}
                  disabled={notClient || loading || !loaded}
                  onChange={() => {
                    setSelected(key);
                    setMessage(null);
                    setSaved(false);
                    if (signedOut) {
                      setMessage("Sign in to vote.");
                      return;
                    }
                    void submitVote(key);
                  }}
                />
                <span className={styles.copy}>
                  <strong>
                    {hasVoted && checked && (
                      <Check
                        className={styles.selectedCheck}
                        size={14}
                        strokeWidth={3}
                        aria-hidden="true"
                      />
                    )}
                    {title}
                  </strong>
                  {!compact && <small>{detail}</small>}
                </span>
                {hasVoted ? (
                  <span
                    className={styles.percentage}
                    aria-label={`${result.count} ${
                      result.count === 1 ? "vote" : "votes"
                    }`}
                  >
                    {result.percent}%
                  </span>
                ) : (
                  <span className={styles.radio} aria-hidden="true">
                    {checked && <Check size={14} strokeWidth={3} />}
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>

        {!notClient && (
          <label className={styles.suggestionLabel}>
            Suggest something else <span>(optional)</span>
            <textarea
              rows={2}
              maxLength={500}
              value={suggestion}
              onChange={(event) => setSuggestion(event.target.value)}
              placeholder="What other service would make life easier?"
            />
          </label>
        )}

        {message && (
          <p
            className={saved ? styles.success : styles.error}
            role="status"
            aria-live="polite"
          >
            {saved && <Check size={15} />}
            {message}
          </p>
        )}

        {notClient ? (
          <p className={styles.notice}>
            Voting is for client accounts. Your jobs and hours are in the{" "}
            <Link href="/worker/current">provider portal</Link>.
          </p>
        ) : signedOut ? (
          <Link className={styles.submit} href="/login">
            Sign in to vote
          </Link>
        ) : hasVoted ? (
          <div className={styles.resultsFooter}>
            <span>
              {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
            </span>
            <button
              className={styles.saveSuggestion}
              type="button"
              disabled={loading || !selected}
              onClick={() =>
                void submitVote(selected, "Your vote and suggestion are saved.")
              }
            >
              {loading ? "Saving…" : "Save suggestion"}
            </button>
          </div>
        ) : (
          <p className={styles.voteHint}>
            {loading ? "Saving your vote…" : "Choose an option to vote"}
          </p>
        )}
      </div>
    </div>
  );
}
