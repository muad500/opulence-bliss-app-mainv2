"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SOCIAL_LINKS,
  parseSocialLinks,
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
  type SocialLinkSettings,
} from "@/lib/socialLinks";
import styles from "./SocialLinksSettings.module.css";

export default function SocialLinksSettings() {
  const [links, setLinks] = useState<SocialLinkSettings>({
    ...DEFAULT_SOCIAL_LINKS,
  });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/social-links", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Social links could not be loaded.");
        setLinks(parseSocialLinks(result.links));
        setLoaded(true);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Social links could not be loaded.",
          );
      });
    return () => controller.abort();
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const validated = parseSocialLinks(links);
      const response = await fetch("/api/admin/social-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: validated }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Social links could not be saved.");
      setLinks(parseSocialLinks(result.links));
      setMessage(
        "Social links saved. They appear in this site's footer when the page is next opened or refreshed.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Social links could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="social-settings-heading">
      <h2 id="social-settings-heading">Footer social links</h2>
      <p>
        Use the full HTTPS page URLs. The purple footer shows icons only; links
        open in a new tab.
      </p>
      <p>
        Leave a link blank to hide that icon. Nextdoor stays visible as a
        non-clickable placeholder until its link is added. Production and
        staging have separate settings.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      {!loaded ? (
        !error && <p role="status">Loading social links…</p>
      ) : (
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <legend className={styles.srOnly}>Social page URLs</legend>
            {SOCIAL_PLATFORMS.map((platform) => (
              <label key={platform} htmlFor={`social-${platform}`}>
                {SOCIAL_LABELS[platform]}
                <input
                  id={`social-${platform}`}
                  name={platform}
                  type="url"
                  maxLength={2048}
                  placeholder={
                    platform === "nextdoor"
                      ? "https://nextdoor.co.uk/pages/…"
                      : DEFAULT_SOCIAL_LINKS[platform]
                  }
                  value={links[platform]}
                  onChange={(event) => {
                    setLinks({ ...links, [platform]: event.target.value });
                    setMessage("");
                  }}
                />
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save social links"}
          </button>
        </form>
      )}
    </section>
  );
}
