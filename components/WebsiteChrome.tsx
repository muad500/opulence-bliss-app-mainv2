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

export default function WebsiteChrome({
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
      <TopBar />
      <SiteHeader />
      {children}
      <Toaster />
      <AccountChangeVerification />
      <RatingGate />
      <div data-app-chat>
        <SupportChat />
      </div>
    </MobileExperience>
  );
}
