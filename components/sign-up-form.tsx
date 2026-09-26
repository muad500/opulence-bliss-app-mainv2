"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isValidUkPhone } from "@/lib/ukPhone";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import GoogleAuthButton from "@/components/GoogleAuthButton";

export function SignUpForm() {
  const [salutation, setSalutation] = useState<"ms_mrs" | "mr" | "">("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const emailValid = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email.trim());
  const phoneValid = isValidUkPhone(phone);
  const phoneEntered = phone.trim().length > 0;
  const phoneOk = !phoneEntered || phoneValid;
  const phoneError = phoneTouched && phoneEntered && !phoneValid;

  async function handleSignUp(event: React.FormEvent) {
    event.preventDefault();
    setEmailTouched(true);
    setPhoneTouched(true);
    setError(null);

    if (!salutation || !firstName.trim() || !lastName.trim() || !email.trim() || !address.trim() || password.length < 6) {
      setError("Complete every field. Your password must have at least 6 characters.");
      return;
    }
    if (!consentAccepted) {
      setError("Accept the Terms & Conditions, Privacy Policy and Cancellation & Refund Policy to create your account.");
      return;
    }
    if (!emailValid || !phoneOk) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/client-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          salutation,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          password,
          consentAccepted,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not create your account.");
      router.push("/auth/sign-up-success");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="signup-shell">
      <section className="signup-card">
        <h1>CREATE YOUR ACCOUNT</h1>
        <p className="lede">Sign up to book visits, message professionals and manage your account.</p>

        <div className="google-signup">
          <ConsentCheckbox checked={consentAccepted} onChange={setConsentAccepted} />
          <GoogleAuthButton
            label="Sign up with Google"
            disabled={!consentAccepted}
            onError={(message) => setError(message || null)}
          />
          {!consentAccepted && <p>Accept the terms above to continue with Google.</p>}
        </div>

        <div className="divider"><span>or sign up with email</span></div>

        <form onSubmit={handleSignUp} noValidate>
          <fieldset className="title-options">
            <legend className="sr-only">Title</legend>
            <label>
              <input type="radio" name="salutation" checked={salutation === "ms_mrs"} onChange={() => setSalutation("ms_mrs")} />
              <span aria-hidden="true" /> Ms / Mrs
            </label>
            <label>
              <input type="radio" name="salutation" checked={salutation === "mr"} onChange={() => setSalutation("mr")} />
              <span aria-hidden="true" /> Mr
            </label>
          </fieldset>

          <label className="sr-only" htmlFor="client-first-name">First name</label>
          <input id="client-first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="First name" autoComplete="given-name" />

          <label className="sr-only" htmlFor="client-last-name">Last name</label>
          <input id="client-last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Last name" autoComplete="family-name" />

          <div className={`phone-field ${phoneError ? "invalid" : ""}`}>
            <svg className="uk-flag" viewBox="0 0 60 30" role="img" aria-label="United Kingdom">
              <rect width="60" height="30" fill="#012169" />
              <path d="M0 0 60 30M60 0 0 30" stroke="#fff" strokeWidth="8" />
              <path d="M0 0 60 30M60 0 0 30" stroke="#C8102E" strokeWidth="4" />
              <path d="M30 0V30M0 15H60" stroke="#fff" strokeWidth="10" />
              <path d="M30 0V30M0 15H60" stroke="#C8102E" strokeWidth="6" />
            </svg>
            <span className="phone-code">+44</span>
            <label className="sr-only" htmlFor="client-phone">Telephone number (optional)</label>
            <input id="client-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} onBlur={() => setPhoneTouched(true)} placeholder="Telephone number (optional)" autoComplete="tel" inputMode="numeric" aria-invalid={phoneError} aria-describedby={phoneError ? "client-phone-error" : "client-phone-help"} />
          </div>
          {phoneError && <p className="field-error" id="client-phone-error">Invalid phone number</p>}
          <p className="phone-help" id="client-phone-help">Optional for now. You will need one before your first booking, so your professional can reach you on the day. It is used only for booking-related contact.</p>

          <label className="sr-only" htmlFor="client-email">Email</label>
          <input id="client-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={() => setEmailTouched(true)} placeholder="Email" autoComplete="email" className={emailTouched && !emailValid ? "invalid" : undefined} aria-invalid={emailTouched && !emailValid} aria-describedby={emailTouched && !emailValid ? "client-email-error" : undefined} />
          {emailTouched && !emailValid && <p className="field-error" id="client-email-error">Invalid email</p>}

          <label className="sr-only" htmlFor="client-address">Address</label>
          <input id="client-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Address" autoComplete="street-address" />

          <div className="password-field">
            <label className="sr-only" htmlFor="client-password">Password</label>
            <input id="client-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="new-password" />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((shown) => !shown)}>
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit" type="submit" disabled={isLoading || !consentAccepted}>{isLoading ? "Creating account…" : "Sign up"}</button>
        </form>

        <p className="account-link">Already signed up? <Link href="/login">Log in here</Link></p>
        <p className="professional-link">Are you a professional? <Link href="/provider/join">Sign up here</Link></p>
      </section>

      <style jsx>{`
        .signup-shell { min-height: 100vh; display: grid; place-items: center; padding: 42px 20px; box-sizing: border-box; background: radial-gradient(circle at 12% 10%, rgba(245,197,66,.2), transparent 28%), linear-gradient(145deg,#fffdf8,#fbf7ff); color: #16202a; font-family: "Nunito",system-ui,sans-serif; }
        .signup-card { width: min(100%, 470px); box-sizing: border-box; padding: 34px; border: 1px solid #e7e1ef; border-top: 6px solid #6d28d9; border-radius: 24px; background: rgba(255,255,255,.97); box-shadow: 0 22px 60px rgba(55,37,78,.13); }
        h1 { margin: 0 0 8px; font-size: clamp(27px,7vw,34px); line-height: 1.08; letter-spacing: -.035em; font-weight: 900; }
        .lede { margin: 0 0 25px; color: #707784; font-size: 15px; line-height: 1.5; font-weight: 600; }
        .google-signup { display: grid; gap: 9px; }
        .google-signup > p { margin: -2px 0 0; color: #8a919b; font-size: 11.5px; text-align: center; }
        .divider { display: flex; align-items: center; gap: 10px; margin: 17px 0; color: #8a919b; font-size: 11px; font-weight: 800; text-transform: uppercase; }
        .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: #e7e9ed; }
        form { display: grid; }
        input { width: 100%; min-height: 44px; box-sizing: border-box; margin: 0 0 8px; padding: 9px 12px; border: 1.5px solid #dfe2e7; border-radius: 12px; background: #fff; color: #16202a; font: inherit; font-size: 16px; }
        input:focus-visible { outline: none; border-color: #6d28d9; box-shadow: 0 0 0 3px rgba(109,40,217,.1); }
        input.invalid, input.invalid:focus-visible, .phone-field.invalid, .phone-field.invalid:focus-within { border-color: #e5394f; box-shadow: 0 0 0 3px rgba(229,57,79,.08); }
        .title-options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 0 14px; padding: 0; border: 0; }
        .title-options label { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; border-radius: 11px; background: #f5f3f2; font-size: 14px; font-weight: 800; cursor: pointer; }
        .title-options input { position: absolute; width: 1px; height: 1px; min-height: 0; margin: 0; opacity: 0; }
        .title-options span { width: 16px; height: 16px; box-sizing: border-box; border: 1.5px solid #8e96a1; border-radius: 50%; background: #fff; box-shadow: inset 0 0 0 4px #fff; }
        .title-options input:checked + span { border-color: #6d28d9; background: #6d28d9; }
        .title-options input:focus-visible + span { outline: 3px solid rgba(109,40,217,.18); outline-offset: 2px; }
        .phone-field { display: grid; grid-template-columns: auto auto minmax(0,1fr); align-items: center; min-height: 44px; margin-bottom: 6px; padding-left: 13px; border: 1.5px solid #dfe2e7; border-radius: 12px; background: #fff; }
        .phone-field:focus-within { border-color: #6d28d9; box-shadow: 0 0 0 3px rgba(109,40,217,.1); }
        .phone-field input { min-height: 41px; margin: 0; padding-left: 4px; border: 0; box-shadow: none; }
        .phone-field input:focus-visible { box-shadow: none; }
        .uk-flag { display: block; width: 24px; height: 16px; overflow: hidden; border-radius: 2px; box-shadow: 0 0 0 1px rgba(22,32,42,.15); }
        .phone-code { margin: 0 7px; color: #5f6874; font-size: 14px; font-weight: 800; }
        .phone-help { margin: 0 2px 14px; color: #9298a1; font-size: 12.5px; line-height: 1.35; }
        .password-field { position: relative; }
        .password-field input { padding-right: 54px; }
        .password-field button { position: absolute; top: 8px; right: 9px; display: grid; width: 38px; height: 38px; place-items: center; border: 0; background: transparent; color: #16202a; cursor: pointer; }
        .field-error { margin: -1px 2px 12px; color: #d82f45; font-size: 12.5px; font-weight: 700; }
        .form-error { margin: 0 0 14px; padding: 11px 13px; border-radius: 11px; background: #ffe9ed; color: #a92f47; font-size: 13.5px; font-weight: 700; }
        .submit { width: 100%; padding: 14px; border: 0; border-radius: 999px; color: #fff; background: linear-gradient(100deg,#f5c542,#c86fc9 55%,#7b2ff7); box-shadow: 0 8px 20px rgba(109,40,217,.22); cursor: pointer; font: inherit; font-size: 15.5px; font-weight: 900; }
        .submit:disabled { opacity: .65; cursor: wait; }
        .account-link, .professional-link { margin: 22px 0 0; text-align: center; color: #59616d; font-size: 14px; }
        .professional-link { padding-top: 19px; border-top: 1px solid #ece9f0; }
        a { color: #6d28d9; font-weight: 900; text-underline-offset: 3px; }
        @media (hover: hover) and (pointer: fine) {
          input { min-height: 40px; margin-bottom: 7px; padding: 7px 11px; }
          .phone-field { min-height: 40px; }
          .phone-field input { min-height: 37px; margin: 0; }
          .password-field button { top: 1px; }
        }
        @media (max-width: 520px) { .signup-shell { align-items: start; padding: 20px 14px; } .signup-card { padding: 27px 22px 25px; } }
      `}</style>
    </main>
  );
}
