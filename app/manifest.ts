import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Opulence Bliss",
    short_name: "Opulence Bliss",
    description:
      "Book home cleaning and manage your visits or professional jobs.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#6d28d9",
    lang: "en-GB",
    icons: [
      { src: "/icons/app-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/app-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Book a clean", short_name: "Book", url: "/book" },
      { name: "My account", short_name: "Account", url: "/account" },
      { name: "My jobs", short_name: "Jobs", url: "/worker" },
    ],
  };
}
