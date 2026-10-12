"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  APP_AUDIENCE_KEY,
  audienceForPath,
  appEntry,
  appPathAllowed,
  type AppAudience,
} from "@/lib/mobileExperience";
import MobileAppChrome from "./MobileAppChrome";
const AppContext = createContext<AppAudience | null>(null);
export const useAppAudience = () => useContext(AppContext);
export default function MobileExperience({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const routeAudience = audienceForPath(path);
  const [saved, setSaved] = useState<AppAudience | null>(null);
  const audience = routeAudience ?? saved;
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(APP_AUDIENCE_KEY);
      const next =
        routeAudience ??
        (stored === "customer" || stored === "worker" ? stored : null);
      setSaved(next);
      if (next) sessionStorage.setItem(APP_AUDIENCE_KEY, next);
    } catch {
      if (routeAudience) setSaved(routeAudience);
    }
  }, [routeAudience]);
  useEffect(() => {
    if (audience) document.documentElement.dataset.opulenceApp = audience;
    else delete document.documentElement.dataset.opulenceApp;
  }, [audience]);
  useEffect(() => {
    if (audience && !appPathAllowed(audience, path))
      router.replace(appEntry(audience));
  }, [audience, path, router]);
  // The choice affects presentation only. Existing server permission checks still apply.
  return (
    <AppContext.Provider value={audience}>
      {audience && <MobileAppChrome audience={audience} />}
      <div data-app-content>{children}</div>
    </AppContext.Provider>
  );
}
