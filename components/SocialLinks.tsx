"use client";

import { useEffect, useState } from "react";
import { Facebook, Instagram } from "lucide-react";
import {
  DEFAULT_SOCIAL_LINKS,
  parseSocialLinks,
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
} from "@/lib/socialLinks";
import styles from "./SocialLinks.module.css";
export default function SocialLinks({
  variant = "default",
}: {
  variant?: "default" | "footer";
}) {
  const [links, setLinks] = useState(DEFAULT_SOCIAL_LINKS);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/social-links", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.ok)
          setLinks(parseSocialLinks((await response.json()).links));
      })
      .catch(() => {
        /* Keep the established links if the network is unavailable. */
      });
    return () => controller.abort();
  }, []);
  return (
    <nav
      className={`${styles.links} ${variant === "footer" ? styles.footer : ""}`}
      aria-label="Opulence Bliss social pages"
    >
      {SOCIAL_PLATFORMS.filter((platform) => links[platform]).map(
        (platform) => (
          <a
            key={platform}
            href={links[platform]}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={SOCIAL_LABELS[platform]}
            title={SOCIAL_LABELS[platform]}
          >
            {platform === "facebook" ? (
              <Facebook aria-hidden="true" size={22} />
            ) : platform === "instagram" ? (
              <Instagram aria-hidden="true" size={22} />
            ) : platform === "nextdoor" ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
              >
                <path d="M3 6h4v2a6 6 0 0 1 11 3v10h-4V11a3 3 0 0 0-6 0v10H3V6Zm15-5h4v4h-4z" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
              >
                <path d="M16 2c.5 3 2.2 4.7 5 5v4a10 10 0 0 1-5-2v8a6 6 0 1 1-6-6h1v4h-1a2 2 0 1 0 2 2V2z" />
              </svg>
            )}
            {variant !== "footer" && <span>{SOCIAL_LABELS[platform]}</span>}
          </a>
        ),
      )}
      {!links.nextdoor && (
        <span
          className={styles.placeholder}
          role="img"
          aria-label="Nextdoor — link coming soon"
          title="Nextdoor — link coming soon"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="currentColor"
          >
            <path d="M3 6h4v2a6 6 0 0 1 11 3v10h-4V11a3 3 0 0 0-6 0v10H3V6Zm15-5h4v4h-4z" />
          </svg>
          {variant !== "footer" && <span>Nextdoor</span>}
        </span>
      )}
    </nav>
  );
}
