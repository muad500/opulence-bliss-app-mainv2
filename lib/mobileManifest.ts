import type { MetadataRoute } from "next";
import { appEntry, type AppAudience } from "./mobileExperience";
export function mobileManifest(audience: AppAudience): MetadataRoute.Manifest {
  const worker = audience === "worker";
  return {
    id: appEntry(audience),
    name: worker ? "Opulence Bliss Pro" : "Opulence Bliss",
    short_name: worker ? "OB Pro" : "Opulence Bliss",
    description: worker
      ? "Manage jobs, availability, messages and earnings."
      : "Book cleaning and manage your visits, messages and account.",
    start_url: appEntry(audience),
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: worker ? "#16202a" : "#6d28d9",
    lang: "en-GB",
    icons: [
      {
        src: worker ? "/icons/pro-192.png" : "/icons/app-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: worker ? "/icons/pro-512.png" : "/icons/app-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: worker
          ? "/icons/pro-maskable-512.png"
          : "/icons/app-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: worker
      ? [
          {
            name: "My jobs",
            short_name: "Jobs",
            url: appEntry(audience, "jobs"),
          },
          {
            name: "Availability",
            short_name: "Hours",
            url: appEntry(audience, "hours"),
          },
          {
            name: "Earnings",
            short_name: "Earnings",
            url: appEntry(audience, "earnings"),
          },
        ]
      : [
          {
            name: "Book a clean",
            short_name: "Book",
            url: appEntry(audience, "book"),
          },
          {
            name: "My bookings",
            short_name: "Bookings",
            url: appEntry(audience, "bookings"),
          },
        ],
  };
}
