/** Never route a live payment to the shared test account. */
export function payoutDestination(
  providerAccount: string | null | undefined,
  options: { livemode: boolean; testAccount?: string | null },
): string | null {
  return providerAccount?.trim() ||
    (options.livemode ? null : options.testAccount?.trim() || null);
}

/** New visit and tip payouts always belong to the assigned cleaner, even in test mode. */
export function assignedProviderDestination(providerAccount: string | null | undefined): string | null {
  return providerAccount?.trim() || null;
}

export function isTestStripeKey(secret: string | undefined): boolean {
  return Boolean(secret && /^(sk|rk)_test_/.test(secret));
}
