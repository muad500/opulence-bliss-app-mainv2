/** Never route a live payment to the shared test account. */
export function payoutDestination(
  providerAccount: string | null | undefined,
  options: { livemode: boolean; testAccount?: string | null },
): string | null {
  return providerAccount?.trim() ||
    (options.livemode ? null : options.testAccount?.trim() || null);
}

export function isTestStripeKey(secret: string | undefined): boolean {
  return Boolean(secret && /^(sk|rk)_test_/.test(secret));
}
