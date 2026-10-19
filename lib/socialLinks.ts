export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "nextdoor",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialLinkSettings = Record<SocialPlatform, string>;

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  nextdoor: "Nextdoor",
};
export const DEFAULT_SOCIAL_LINKS: SocialLinkSettings = {
  facebook: "https://www.facebook.com/opulencebliss",
  instagram: "https://www.instagram.com/opulencebliss/",
  tiktok: "https://www.tiktok.com/@opulencebliss",
  nextdoor: "",
};
const HOSTS: Record<SocialPlatform, string[]> = {
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  nextdoor: ["nextdoor.com", "nextdoor.co.uk"],
};

export function parseSocialLinks(value: unknown): SocialLinkSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Enter the social page links.");
  }
  return Object.fromEntries(
    SOCIAL_PLATFORMS.map((platform) => {
      const raw = (value as Record<string, unknown>)[platform];
      if (typeof raw !== "string" || raw.length > 2048) {
        throw new Error(
          `Enter a valid ${SOCIAL_LABELS[platform]} link, or leave it blank.`,
        );
      }
      const text = raw.trim();
      if (!text) return [platform, ""];
      let url: URL;
      try {
        url = new URL(text);
      } catch {
        throw new Error(
          `Enter the full https:// ${SOCIAL_LABELS[platform]} page link.`,
        );
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !HOSTS[platform].some(
          (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        )
      ) {
        throw new Error(
          `Use an official HTTPS ${SOCIAL_LABELS[platform]} page link.`,
        );
      }
      return [platform, url.href];
    }),
  ) as SocialLinkSettings;
}

export function socialLinksFromRows(
  rows: Array<{ platform: string; url: string | null }>,
): SocialLinkSettings {
  const links = { ...DEFAULT_SOCIAL_LINKS };
  for (const row of rows) {
    if (SOCIAL_PLATFORMS.includes(row.platform as SocialPlatform)) {
      links[row.platform as SocialPlatform] = row.url ?? "";
    }
  }
  return parseSocialLinks(links);
}
