// SETUP: code "app/layout.tsx"
//
// Root layout — fonts, metadata, and the components that appear on every page.

import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import "./mobile-app.css";

import WebsiteChrome from "@/components/WebsiteChrome";
import ScopedStyleRegistry from "@/components/StyleRegistry";

// Self-hosted by Next, so no extra request to Google and no flash of
// unstyled text. Components ask for "Nunito" by name and get this.
const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Opulence Bliss",
    statusBarStyle: "default",
  },
  icons: { apple: "/icons/app-192.png" },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Opulence Bliss — trusted home cleaning in London",
  description:
    "Vetted home cleaners across London. Book flexible home-cleaning visits with clear prices and secure payments.",
  robots:
    process.env.VERCEL_ENV === "preview"
      ? { index: false, follow: false, noarchive: true }
      : { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6d28d9",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${nunito.className} ${nunito.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var p=location.pathname,m=p==="/partners"?null:p.startsWith("/mobile/customer")?"customer":p.startsWith("/mobile/worker")?"worker":sessionStorage.getItem("opulence-app-audience");if(m==="customer"||m==="worker")document.documentElement.dataset.opulenceApp=m;}catch{}',
          }}
        />
        <ScopedStyleRegistry>
          <WebsiteChrome>{children}</WebsiteChrome>
        </ScopedStyleRegistry>
      </body>
    </html>
  );
}
