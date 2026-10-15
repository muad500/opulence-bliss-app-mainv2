"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeAuthNext } from "@/lib/authReturn";

export default function GoogleAuthButton({
  label,
  next,
  disabled = false,
  onError,
}: {
  label: string;
  next?: string;
  disabled?: boolean;
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function continueWithGoogle() {
    setBusy(true);
    onError?.("");

    const requestedNext =
      safeAuthNext(
        next ?? new URLSearchParams(window.location.search).get("next"),
      ) ?? "/account";
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", requestedNext);
    callback.searchParams.set("intent", "customer");

    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });

    if (error) {
      onError?.(error.message);
      setBusy(false);
    }
  }

  return (
    <button
      className="google-auth-button"
      type="button"
      onClick={() => void continueWithGoogle()}
      disabled={disabled || busy}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
        />
        <path
          fill="#34A853"
          d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
        />
        <path
          fill="#FBBC05"
          d="M6.39 13.86A6 6 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.48l3.35-2.62Z"
        />
        <path
          fill="#EA4335"
          d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z"
        />
      </svg>
      {busy ? "Opening Google…" : label}

      <style jsx>{`
        .google-auth-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          min-height: 46px;
          padding: 10px 16px;
          border: 1.5px solid #d9dde3;
          border-radius: 999px;
          background: #fff;
          color: #25303b;
          font: inherit;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
        }
        .google-auth-button:hover {
          border-color: #9e76db;
          background: #fdfbff;
        }
        .google-auth-button:focus-visible {
          outline: 3px solid rgba(109, 40, 217, 0.2);
          outline-offset: 2px;
        }
        .google-auth-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        svg {
          width: 19px;
          height: 19px;
          flex: 0 0 auto;
        }
      `}</style>
    </button>
  );
}
