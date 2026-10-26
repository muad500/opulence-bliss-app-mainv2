"use client";
import { CUSTOMER_SIGNUP_ACCEPTANCE } from "@/lib/accountAcceptanceCopy";
import { CANCELLATION_REFUND_URL, PRIVACY_URL, TERMS_URL } from "@/lib/legal";

export default function ConsentCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        margin: "16px 0",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <input
        aria-label={CUSTOMER_SIGNUP_ACCEPTANCE}
        type="checkbox"
        required
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ width: 18, minWidth: 18, height: 18, marginTop: 3 }}
      />
      <span>
        I have read and accept the{" "}
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "underline" }}
        >
          Terms &amp; Conditions
        </a>
        ,{" "}
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "underline" }}
        >
          Privacy Policy
        </a>{" "}
        and{" "}
        <a
          href={CANCELLATION_REFUND_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "underline" }}
        >
          Cancellation &amp; Refund Policy
        </a>
        .
      </span>
    </label>
  );
}
