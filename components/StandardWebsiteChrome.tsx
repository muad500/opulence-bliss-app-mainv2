"use client";

import { usePathname } from "next/navigation";
import { isStaffPath } from "@/lib/adminHosts";
import AccountChangeVerification from "./AccountChangeVerification";
import MobileExperience from "./MobileExperience";
import TopBar from "./TopBar";
import SiteHeader from "./SiteHeader";
import Toaster from "./Toaster";
import RatingGate from "./RatingGate";
import SupportChat from "./SupportChat";
import EnvironmentBanner from "./EnvironmentBanner";
import MobileAppSupport from "./MobileAppSupport";
import PushNotifications from "./PushNotifications";

export default function StandardWebsiteChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname() ?? "/";
  if (isStaffPath(path))
    return (
      <>
        <EnvironmentBanner />
        {children}
        <Toaster />
      </>
    );
  return (
    <MobileExperience>
      <MobileAppSupport />
      <EnvironmentBanner />
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <TopBar />
      <SiteHeader />
      <PushNotifications />
      <div id="main-content" tabIndex={-1}>
        {children}
      </div>
      <Toaster />
      <AccountChangeVerification />
      <RatingGate />
      <div data-app-chat>
        <SupportChat />
      </div>
    </MobileExperience>
  );
}
