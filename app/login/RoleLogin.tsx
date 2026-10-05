"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import GoogleAuthButton from "@/components/GoogleAuthButton";

const supabase = createClient();

type Mode = "client" | "provider";

const COPY = {
  client: {
    title: "SIGN IN",
    body: "Manage your bookings, messages and payments.",
    button: "Sign in",
    destination: "/account",
    switchText: "Are you an Opulence Bliss professional?",
    switchLabel: "Sign in as a pro",
    switchHref: "/provider/login",
    signupText: "New client?",
    signupLabel: "Sign up",
    signupHref: "/auth/sign-up",
  },
  provider: {
    title: "SIGN IN AS A PRO",
    body: "Sign in to manage offers, visits, messages, hours and earnings.",
    button: "Sign in as a pro",
    destination: "/worker",
    switchText: "Looking for your bookings?",
    switchLabel: "Sign in",
    switchHref: "/login",
    signupText: "New professional?",
    signupLabel: "Sign up",
    signupHref: "/provider/join",
  },
} as const;

export default function RoleLogin({ mode }: { mode: Mode }) {
  const content = COPY[mode];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "wrong-account") {
      setErr("This account needs administrator sign-in. Please use the admin page.");
    } else if (reason) {
      setErr("Google sign-in could not be completed. Please try again.");
    }
  }, []);

  async function signIn(em: string, pw: string) {
    setBusy(true);
    setErr(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: em.trim(),
      password: pw,
    });

    if (error || !data.user) {
      setErr(error?.message ?? "We couldn't sign you in.");
      setBusy(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile || profile.role === "admin") {
      await supabase.auth.signOut();
      setErr("This account cannot use this sign-in page. Please contact support if you need help.");
      setBusy(false);
      return;
    }

    if (mode === "provider") {
      const { data: provider } = await supabase.from("providers")
        .select("id").eq("profile_id", data.user.id).maybeSingle();
      if (!provider) {
        window.location.href = "/provider/join";
        return;
      }
    }

    const next = new URLSearchParams(window.location.search).get("next");
    const {data:details}=await supabase.from('account_profile_details').select('last_account_mode').eq('user_id',data.user.id).maybeSingle();
    const {data:professional}=await supabase.from('providers').select('id').eq('profile_id',data.user.id).maybeSingle();
    const destination=mode==='client'&&professional&&details?.last_account_mode==='professional'?'/worker':content.destination;
    window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : destination;
  }

  function submit() {
    if (!email.trim() || !password) {
      setErr("Enter your email and password.");
      return;
    }
    void signIn(email, password);
  }

  return (
    <main className={`login-shell ${mode}`}>
      <section className="login-card">
        <h1>{content.title}</h1>
        <p className="lede">{content.body}</p>

        {mode === "client" && (
          <>
            <GoogleAuthButton
              label="Continue with Google"
              onError={(message) => setErr(message || null)}
            />
            <p className="google-terms">
              By continuing, you agree to our <Link href="/legal/terms">Terms</Link>,{" "}
              <Link href="/legal/privacy">Privacy Policy</Link> and{" "}
              <Link href="/legal/cancellation-refund">Cancellation &amp; Refund Policy</Link>.
            </p>
            <div className="divider"><span>or use email</span></div>
          </>
        )}

        <label htmlFor={`${mode}-email`}>Email</label>
        <input
          id={`${mode}-email`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />

        <label htmlFor={`${mode}-password`}>Password</label>
        <input
          id={`${mode}-password`}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          placeholder="••••••••"
          autoComplete="current-password"
        />

        <button className="submit" type="button" onClick={submit} disabled={busy}>
          {busy ? "Signing in…" : content.button}
        </button>

        {err && <p className="error">{err}</p>}

        <div className="switch-role">
          <span>{content.switchText}</span>
          <a href={content.switchHref}>{content.switchLabel} →</a>
        </div>

        <p className="join">
          {content.signupText} <a href={content.signupHref}>{content.signupLabel}</a>
        </p>

        <Link className="home" href="/">
          ← Back to website
        </Link>
      </section>

      <style jsx>{`
        .login-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 42px 20px;
          color: #16202a;
          font-family: "Nunito", system-ui, sans-serif;
        }
        .login-shell.client {
          background:
            radial-gradient(circle at 12% 10%, rgba(245, 197, 66, 0.2), transparent 28%),
            linear-gradient(145deg, #fffdf8, #fbf7ff);
        }
        .login-shell.provider {
          background:
            radial-gradient(circle at 85% 12%, rgba(200, 111, 201, 0.2), transparent 32%),
            linear-gradient(145deg, #f8f4ff, #eee7fb);
        }
        .login-card {
          width: min(100%, 470px);
          box-sizing: border-box;
          padding: 34px 34px 30px;
          border: 1px solid #e7e1ef;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 22px 60px rgba(55, 37, 78, 0.13);
        }
        .provider .login-card {
          border-top: 6px solid #6d28d9;
        }
        .role-mark {
          float: right;
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          border-radius: 17px;
          color: #6d28d9;
          background: #f2eafd;
          font-size: 24px;
          font-weight: 900;
        }
        .provider .role-mark {
          color: #fff;
          background: linear-gradient(135deg, #c86fc9, #6d28d9);
          font-size: 17px;
        }
        .brand {
          display: inline-block;
          margin-bottom: 35px;
          color: #16202a;
          font-size: 21px;
          font-weight: 900;
          letter-spacing: -0.03em;
          text-decoration: none;
        }
        .brand span,
        .eyebrow,
        .switch-role a,
        .join a,
        .home {
          color: #6d28d9;
        }
        .eyebrow {
          margin: 0 0 7px;
          text-transform: uppercase;
          letter-spacing: 0.13em;
          font-size: 12px;
          font-weight: 900;
        }
        h1 {
          margin: 0 0 7px;
          font-size: clamp(28px, 7vw, 36px);
          line-height: 1.08;
          letter-spacing: -0.035em;
          font-weight: 900;
        }
        .lede {
          margin: 0 0 25px;
          color: #707784;
          font-size: 15.5px;
          line-height: 1.5;
          font-weight: 600;
        }
        .google-terms {
          margin: 8px 8px 14px;
          color: #7a828c;
          font-size: 11.5px;
          line-height: 1.4;
          text-align: center;
        }
        .google-terms :global(a) { color: #6d28d9; font-weight: 800; }
        .divider {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 4px 0 15px;
          color: #8a919b;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: #e7e9ed; }
        label {
          display: block;
          margin: 0 0 6px;
          color: #555e6b;
          font-size: 13.5px;
          font-weight: 800;
        }
        input {
          width: 100%;
          box-sizing: border-box;
          min-height: 44px;
          margin: 0 0 8px;
          padding: 9px 12px;
          border: 1.5px solid #dfe2e7;
          border-radius: 12px;
          background: #fff;
          color: #16202a;
          font: inherit;
          font-size: 16px;
        }
        @media (hover: hover) and (pointer: fine) {
          input {
            min-height: 40px;
            padding: 7px 11px;
            margin-bottom: 7px;
          }
        }
        input:focus-visible {
          outline: none;
          border-color: #6d28d9;
          box-shadow: 0 0 0 3px rgba(109, 40, 217, 0.1);
        }
        .submit {
          width: 100%;
          margin-top: 4px;
          padding: 14px;
          border: none;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(100deg, #f5c542, #c86fc9 55%, #7b2ff7);
          box-shadow: 0 8px 20px rgba(109, 40, 217, 0.22);
          cursor: pointer;
          font: inherit;
          font-size: 15.5px;
          font-weight: 900;
        }
        .provider .submit {
          background: linear-gradient(100deg, #8b5cf6, #6d28d9);
        }
        .submit:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .error {
          margin: 15px 0 0;
          padding: 11px 13px;
          border-radius: 11px;
          background: #ffe9ed;
          color: #a92f47;
          font-size: 13.5px;
          font-weight: 700;
        }
        .switch-role {
          display: grid;
          gap: 3px;
          margin-top: 22px;
          padding-top: 18px;
          border-top: 1px solid #ece9f0;
          color: #747b86;
          font-size: 13.5px;
        }
        .switch-role a,
        .join a {
          width: fit-content;
          font-weight: 900;
          text-decoration: none;
        }
        .join {
          margin: 13px 0 0;
          color: #747b86;
          font-size: 13.5px;
        }
        .home {
          display: inline-block;
          margin-top: 19px;
          font-size: 13.5px;
          font-weight: 800;
          text-decoration: none;
        }
        @media (max-width: 520px) {
          .login-shell {
            align-items: start;
            padding: 20px 14px;
          }
          .login-card {
            padding: 27px 22px 25px;
          }
          .brand {
            margin-bottom: 30px;
          }
        }
      `}</style>
    </main>
  );
}
