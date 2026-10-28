"use client";
import { useRef, useState } from "react";
import { partnerProgrammeCopy } from "@/lib/partnerProgrammeConfig";
export const PARTNER_SHARE_MESSAGE = partnerProgrammeCopy(
  "Hi, I recommend Opulence Bliss for cleaning in London. Easy to book and the cleaners are checked. If you book with my link you get {{discountTotal}} off your first two bookings ({{discountFirst}} each) and I get a thank-you too.",
);
export default function PartnerShareMessage() {
  const message = useRef<HTMLParagraphElement>(null),
    [feedback, setFeedback] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(PARTNER_SHARE_MESSAGE);
      setFeedback("Copied. Add your own link before you send it.");
    } catch {
      if (message.current) {
        const range = document.createRange();
        range.selectNodeContents(message.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setFeedback(
        "Press and hold, or use Ctrl+C, to copy the selected message.",
      );
    }
  }
  return (
    <div className="msg">
      <div className="lab">A ready-made message you can send</div>
      <p ref={message}>{PARTNER_SHARE_MESSAGE}</p>
      <button
        className="btn ghost copy"
        type="button"
        onClick={() => void copy()}
      >
        Copy message
      </button>
      <p className="hint" role="status">
        {feedback}
      </p>
    </div>
  );
}
