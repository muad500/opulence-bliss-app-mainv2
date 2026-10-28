"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { isStoredUkPhone } from "@/lib/ukPhone";
import {
  PARTNER_INTEREST_CONSENT,
  PARTNER_INTEREST_DESCRIPTIONS,
  PARTNER_INTEREST_THANK_YOU,
} from "@/lib/partnerInterestCopy";

type Fields = "fullName" | "email" | "phone" | "description" | "consent";
const messages: Record<Fields, string> = {
  fullName: "Please enter your full name.",
  email: "Please enter a valid email address.",
  phone: "Please enter a valid phone number.",
  description: "Please choose the option that best describes you.",
  consent: "Please tick the box so we can contact you about the partnership.",
};
export default function PartnerInterestForm() {
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({}),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const form = useRef<HTMLFormElement>(null),
    thanks = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (done) thanks.current?.focus();
  }, [done]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget),
      fullName = String(data.get("fullName") || "").trim(),
      email = String(data.get("email") || "").trim(),
      phone = String(data.get("phone") || "").trim(),
      description = String(data.get("description") || ""),
      consent = data.get("consent") === "on";
    const nationalPhone = parsePhoneNumberFromString(phone, "GB");
    const invalid: Partial<Record<Fields, string>> = {};
    if (fullName.length < 2) invalid.fullName = messages.fullName;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
      invalid.email = messages.email;
    if (!nationalPhone || !isStoredUkPhone(nationalPhone.number))
      invalid.phone = messages.phone;
    if (
      !PARTNER_INTEREST_DESCRIPTIONS.includes(
        description as (typeof PARTNER_INTEREST_DESCRIPTIONS)[number],
      )
    )
      invalid.description = messages.description;
    if (!consent) invalid.consent = messages.consent;
    setErrors(invalid);
    setFailure("");
    if (Object.keys(invalid).length) {
      form.current
        ?.querySelector<HTMLElement>(`[name="${Object.keys(invalid)[0]}"]`)
        ?.focus();
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/partner-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          description,
          consent,
          website: String(data.get("website") || ""),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.fields) setErrors(result.fields);
        throw Error(result.error || "Please try again shortly.");
      }
      setDone(true);
    } catch (cause) {
      setFailure(
        cause instanceof Error ? cause.message : "Please try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  }
  function error(field: Fields) {
    return errors[field] ? (
      <p className="err" id={`partner-${field}-error`}>
        {errors[field]}
      </p>
    ) : null;
  }
  function inputProps(field: Fields) {
    return {
      "aria-invalid": !!errors[field],
      "aria-describedby": errors[field] ? `partner-${field}-error` : undefined,
    };
  }
  return (
    <div className="form">
      {done ? (
        <div className="thanks" ref={thanks} role="status" tabIndex={-1}>
          <h3>{PARTNER_INTEREST_THANK_YOU.title}</h3>
          <p>{PARTNER_INTEREST_THANK_YOU.body}</p>
          <p style={{ marginTop: 12 }}>{PARTNER_INTEREST_THANK_YOU.inbox}</p>
        </div>
      ) : (
        <form
          ref={form}
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-busy={busy}
        >
          <h3 style={{ marginBottom: 18 }}>Become a Partner</h3>
          <div className={`f${errors.fullName ? " bad" : ""}`}>
            <label htmlFor="partner-name">Full name</label>
            <input
              type="text"
              id="partner-name"
              name="fullName"
              autoComplete="name"
              placeholder="e.g. Amara Johnson"
              required
              maxLength={160}
              {...inputProps("fullName")}
            />
            {error("fullName")}
          </div>
          <div className={`f${errors.email ? " bad" : ""}`}>
            <label htmlFor="partner-email">Email address</label>
            <input
              type="email"
              id="partner-email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              maxLength={254}
              {...inputProps("email")}
            />
            {error("email")}
          </div>
          <div className={`f${errors.phone ? " bad" : ""}`}>
            <label htmlFor="partner-phone">Phone number</label>
            <input
              type="tel"
              id="partner-phone"
              name="phone"
              autoComplete="tel"
              placeholder="e.g. 07123 456789"
              required
              maxLength={32}
              {...inputProps("phone")}
            />
            {error("phone")}
          </div>
          <div className={`f${errors.description ? " bad" : ""}`}>
            <label htmlFor="partner-description">
              Which best describes you?
            </label>
            <select
              id="partner-description"
              name="description"
              required
              defaultValue=""
              {...inputProps("description")}
            >
              <option value="">Select an option</option>
              {PARTNER_INTEREST_DESCRIPTIONS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            {error("description")}
          </div>
          <div className="honeypot" aria-hidden="true">
            <label htmlFor="partner-website">Website</label>
            <input
              id="partner-website"
              name="website"
              type="text"
              autoComplete="off"
              tabIndex={-1}
            />
          </div>
          <div className={`f${errors.consent ? " bad" : ""}`}>
            <div className="consent">
              <input
                type="checkbox"
                id="partner-consent"
                name="consent"
                required
                aria-label={PARTNER_INTEREST_CONSENT}
                {...inputProps("consent")}
              />
              <label htmlFor="partner-consent">
                I agree to be contacted about the partnership opportunity and
                have read the{" "}
                <Link prefetch={false} href="/legal/privacy">
                  privacy notice
                </Link>
                .
              </label>
            </div>
            {error("consent")}
          </div>
          {failure && (
            <p className="formError" role="alert">
              {failure}
            </p>
          )}
          <button
            className="btn"
            type="submit"
            style={{ width: "100%" }}
            disabled={busy}
          >
            Register my interest
          </button>
          <p className="small">
            No fees. No obligation. Your details are never shared without your
            permission.
          </p>
        </form>
      )}
    </div>
  );
}
