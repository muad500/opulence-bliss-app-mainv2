"use client";

import { useEffect } from "react";

export default function MobileAppSupport() {
  useEffect(() => {
    const publicHosts = ["www.opulencebliss.com", "opulencebliss.com"];
    if (
      !publicHosts.includes(window.location.hostname) ||
      !window.isSecureContext ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    navigator.serviceWorker
      .register("/app-worker.js", { scope: "/" })
      .catch(() => {
        // Booking and sign-in remain usable if offline support cannot start.
      });
  }, []);

  return null;
}
