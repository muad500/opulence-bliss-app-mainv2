# Client policy wording: one consolidated list

Checked against the **recent 14-PDF pack**, not the older website drafts.

## Already decided on 24 October — do not ask the client to decide again

- Cancellation: 48h+ free; 24–48h 25%; 12–24h 50%; under 12h/on the day up to 70%, default 70%, staff may reduce. Cleaning hours only; tips, add-ons and products refunded. No access: 15 minutes, then the same cap.
- Cleaner compensation is the same proportion of their cleaning-hours pay; a cleaner waiver increases the customer refund.
- Standard cleaner pay £15/hour; Signature Deep Clean and End of Tenancy £17.50/hour. Cleaner receives £4 of the £5 products fee. Pay rises are deferred.
- The statutory 14-day right remains separate. Before work starts, a qualifying customer cancellation during that period is refunded in full. Requesting an early start is not an immediate waiver of that right. See the supplied Cancellation Policy §4 and [regulations 29–36](https://www.legislation.gov.uk/uksi/2013/3134/part/3/made).

The new PDF wording must be brought into line with these decisions **before publication/release**: Cancellation Policy §§5.1, 5.3 and 5.5 currently say no refund under 12 hours/no access and apply the percentage to the whole booking except tips. Customer Terms §§8.1/8.3/8.4 contain the same late-cancellation/charge-basis/no-access issues. Checkout and Sign-up Wording §2.1 already says up to 70%.

## The short remaining client list

1. **Cleaner Terms missing:** a separate final Cleaner Terms and Conditions document is referenced by the new pack but was not among the 14 supplied PDFs. The existing Service Professional Partner Agreement is a different document; do not silently substitute it or invent the missing terms. The Checkout and Sign-up Wording PDF **was received**.
2. **Rescheduling conflicts:** Cancellation Policy §5.4 applies cancellation bands to moves with under 48 hours' notice; Cleaner Cancellation Policy §6.3 says no cancellation charge when a new time is agreed. One consistent clause is needed. This PR does not change rescheduling charges.
3. **Regular-payment wording needs correction:** Checkout and Sign-up Wording §2.1 says payment is taken when booking. The approved existing regular flow saves the card with £0 due today and charges each visit when a cleaner accepts. Align the final wording to that behaviour; this PR does not change the payment schedule.
4. **Later, while the handyman marketplace stays off:** the new professional Handyman Terms specify 25% of labour, materials at cost; the switched-off marketplace uses 20% of the quote. Resolve before enabling it, not by silently changing the rate in this release.
5. **Unlaunched promises:** referral/Partner rewards, loyalty, Booking Credit and massage benefits must not be promised as available before implementation. The referenced Wellness discount agreement/Schedule 1 was not supplied. Keep these deferred rather than delaying the core website for them.

## Owner/onboarding actions, not another client questionnaire

- In Admin → Settings, choose the named onboarding staff before anyone can review DBS evidence. The new list starts empty; existing admin status is not an automatic grant.
- Confirm the operational safeguards promised in the supplied safeguarding policy: emergency contacts collected, onboarding briefing, annual refresher, and a person monitoring/escalating missed check-ins during 7am–8pm. The checkbox does not perform those human duties.
- Keep evidence of any insurance cover the published wording promises. Do not infer company cover from an individual cleaner's certificate.

## Exact source files checked

- `Opulence-Bliss-Checkout-and-Signup-Wording.docx.pdf`, page 1 (§§1–2).
- `Opulence-Bliss-Cancellations-Payment-Refunds-Policy.docx.pdf`, pages 2–3 (§§4–7).
- `Opulence-Bliss-Cleaner-Cancellation-Policy.docx.pdf`, page 2 (§6).
- `Opulence-Bliss-Customer-Terms.docx.pdf`, page 3 (§§7–8).
- `Opulence-Bliss-Handyman-Terms-and-Conditions.docx.pdf`, page 3 (§6).
- `Opulence-Bliss-Safeguarding-Lone-Working-and-Incident-Policy.docx.pdf`, §§2, 4, 9 and 12. The new safeguarding page uses this supplied policy verbatim, with only whitespace/HTML formatting changed.

No contradictory customer-policy PDFs are published by this PR. Safeguarding is the only newly published document. Resolve/approve the wording above before a production “go”.
