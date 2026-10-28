/** Shared by the public calculator and the future Partner reward engine. Amounts are pence. */
export const PARTNER_PROGRAMME = Object.freeze({
  householdRewardPence: Object.freeze([500, 500] as const),
  householdDiscountPence: Object.freeze([500, 500] as const),
  businessInitialPercent: 5,
  businessEstablishedPercent: 10,
  businessInitialCount: 3,
  businessTrialWeeks: 4,
  businessTermMonths: 12,
});

// This must stay off until customer loyalty is implemented and approved to launch.
export const PARTNER_LOYALTY_ENABLED = false;

export function partnerGbp(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return (
    "£" +
    rounded.toLocaleString(
      "en-GB",
      rounded % 1 === 0
        ? undefined
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    )
  );
}
export function partnerNumberWord(value: number) {
  return (
    ({ 3: "three", 4: "fourth" } as Record<number, string>)[value] ??
    String(value)
  );
}
export function partnerProgrammeCopy(template: string) {
  const c = PARTNER_PROGRAMME;
  const values: Record<string, string> = {
    rewardFirst: partnerGbp(c.householdRewardPence[0] / 100),
    rewardSecond: partnerGbp(c.householdRewardPence[1] / 100),
    rewardTotal: partnerGbp(
      c.householdRewardPence.reduce((a, b) => a + b, 0) / 100,
    ),
    discountFirst: partnerGbp(c.householdDiscountPence[0] / 100),
    discountSecond: partnerGbp(c.householdDiscountPence[1] / 100),
    discountTotal: partnerGbp(
      c.householdDiscountPence.reduce((a, b) => a + b, 0) / 100,
    ),
    initialPercent: c.businessInitialPercent + "%",
    establishedPercent: c.businessEstablishedPercent + "%",
    initialCountWord: partnerNumberWord(c.businessInitialCount),
    establishedStartWord: partnerNumberWord(c.businessInitialCount + 1),
    trialWeeks: String(c.businessTrialWeeks),
    termMonths: String(c.businessTermMonths),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error("Unknown Partner copy value: " + key);
    return values[key];
  });
}
export type PartnerCalculatorInput = {
  households: number;
  secondBookingPercent: number;
  businesses: number;
  businessMonthlyFee: number;
};
export function calculatePartnerIllustration(input: PartnerCalculatorInput) {
  const c = PARTNER_PROGRAMME;
  const secondBookings = Math.round(
    (input.households * input.secondBookingPercent) / 100,
  );
  const householdReward =
    (input.households * c.householdRewardPence[0] +
      secondBookings * c.householdRewardPence[1]) /
    100;
  const householdDiscount =
    (input.households * c.householdDiscountPence[0] +
      secondBookings * c.householdDiscountPence[1]) /
    100;
  const businesses = Array.from({ length: input.businesses }, (_, i) => {
    const number = i + 1,
      percent =
        number <= c.businessInitialCount
          ? c.businessInitialPercent
          : c.businessEstablishedPercent;
    return {
      number,
      percent,
      reward: (input.businessMonthlyFee * percent) / 100,
    };
  });
  const businessReward = businesses.reduce((sum, b) => sum + b.reward, 0);
  return {
    secondBookings,
    householdReward,
    householdDiscount,
    businessReward,
    total: householdReward + businessReward,
    businesses,
  };
}
