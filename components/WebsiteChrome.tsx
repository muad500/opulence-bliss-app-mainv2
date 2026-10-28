"use client";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import SiteHeader from "./SiteHeader";
import EnvironmentBanner from "./EnvironmentBanner";
const StandardWebsiteChrome = dynamic(() => import("./StandardWebsiteChrome"));
export default function WebsiteChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  if (path === "/partners")
    return (
      <>
        <EnvironmentBanner />
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <SiteHeader storageFree />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </>
    );
  return <StandardWebsiteChrome>{children}</StandardWebsiteChrome>;
}
