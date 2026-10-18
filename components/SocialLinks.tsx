import { Facebook, Instagram } from "lucide-react";
import styles from "./SocialLinks.module.css";
export const SOCIAL_LINKS = [
  { name: "Facebook", url: "https://www.facebook.com/opulencebliss" },
  { name: "Instagram", url: "https://www.instagram.com/opulencebliss/" },
  { name: "TikTok", url: "https://www.tiktok.com/@opulencebliss" },
];
export default function SocialLinks() {
  return (
    <nav className={styles.links} aria-label="Opulence Bliss social pages">
      {SOCIAL_LINKS.map(({ name, url }) => (
        <a
          key={name}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${name} @opulencebliss`}
        >
          {name === "Facebook" ? (
            <Facebook aria-hidden="true" size={22} />
          ) : name === "Instagram" ? (
            <Instagram aria-hidden="true" size={22} />
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
          <span>{name}</span>
        </a>
      ))}
      <span
        className={styles.nextdoor}
        aria-label="Nextdoor opulencebliss — link coming soon"
      >
        <span aria-hidden="true" className={styles.nextdoorIcon}>
          n
        </span>
        <span>
          Nextdoor<small>opulencebliss</small>
        </span>
      </span>
    </nav>
  );
}
