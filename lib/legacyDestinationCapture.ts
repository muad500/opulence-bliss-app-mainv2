import type Stripe from "stripe";

/** Old one-off PaymentIntents send money to their destination on capture. */
export function hasLegacyDestinationCharge(
  intent: Pick<Stripe.PaymentIntent, "transfer_data">,
): boolean {
  return Boolean(intent.transfer_data?.destination);
}

export class LegacyDestinationCaptureError extends Error {
  constructor(paymentIntentId: string) {
    super(
      `PaymentIntent ${paymentIntentId} has an old transfer_data.destination. ` +
        "Capture is blocked; an admin must review the destination and cleaner payout.",
    );
    this.name = "LegacyDestinationCaptureError";
  }
}

/** Fail closed if Stripe cannot be reached; callers must not capture in that case. */
export async function assertSafeToCaptureBookingPayment(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<void> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (hasLegacyDestinationCharge(intent)) {
    throw new LegacyDestinationCaptureError(paymentIntentId);
  }
}

/** The only capture entry point for one-off bookings, including cancellation. */
export async function captureBookingPayment(
  stripe: Stripe,
  paymentIntentId: string,
  params: Stripe.PaymentIntentCaptureParams,
  options: Stripe.RequestOptions,
): Promise<Stripe.PaymentIntent> {
  await assertSafeToCaptureBookingPayment(stripe, paymentIntentId);
  return stripe.paymentIntents.capture(paymentIntentId, params, options);
}
