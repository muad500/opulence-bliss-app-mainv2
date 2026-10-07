import assert from "node:assert/strict";
import test from "node:test";
import {
  canFinalizeProviderPartnership,
  estimateProviderMonthlyEarnings,
  isProviderCleaningExperienceTypes,
  isProviderCleaningExperienceYears,
  isOptionalUtrNumber,
  isProviderResidentStatus,
  isStrongProviderPassword,
  isProviderTravelDistance,
  isProviderWeeklyAvailability,
  isProviderWeeklyHours,
  providerAvailabilityRows,
  providerApplicationEligibilityError,
} from "./providerOnboarding";

test("professional availability accepts every whole hour from zero through forty", () => {
  assert.equal(isProviderWeeklyHours(0), true);
  assert.equal(isProviderWeeklyHours(40), true);
  assert.equal(isProviderWeeklyHours(-1), false);
  assert.equal(isProviderWeeklyHours(41), false);
  assert.equal(isProviderWeeklyHours(20.5), false);
});

test("the earnings simulation follows the selected weekly hours", () => {
  assert.equal(estimateProviderMonthlyEarnings(0), 0);
  assert.equal(estimateProviderMonthlyEarnings(20), 1440);
  assert.equal(estimateProviderMonthlyEarnings(30), 2160);
  assert.equal(estimateProviderMonthlyEarnings(40), 2880);
});

test("professional status only accepts the displayed UK resident options", () => {
  assert.equal(isProviderResidentStatus("British or Irish citizen"), true);
  assert.equal(isProviderResidentStatus("Student Visa"), true);
  assert.equal(isProviderResidentStatus("Tourist"), false);
});

test("UTR is optional but must contain ten digits when supplied", () => {
  assert.equal(isOptionalUtrNumber(null), true);
  assert.equal(isOptionalUtrNumber(""), true);
  assert.equal(isOptionalUtrNumber("1234567890"), true);
  assert.equal(isOptionalUtrNumber("12345"), false);
  assert.equal(isOptionalUtrNumber("   "), true);
  assert.equal(isOptionalUtrNumber(" 1234567890 "), true);
  assert.equal(isOptionalUtrNumber(1234567890), false);
});

test("self-employment permission cannot be bypassed by agreeing to partner", () => {
  assert.match(providerApplicationEligibilityError("Student Visa", true)!, /Student visa.*cannot continue/);
  assert.match(providerApplicationEligibilityError("Asylum Seeker", true)!, /manual review/);
  assert.match(providerApplicationEligibilityError("British or Irish citizen", false)!, /permission/);
  assert.match(providerApplicationEligibilityError("Tourist", true)!, /Select/);
  assert.equal(providerApplicationEligibilityError("British or Irish citizen", true), null);
  assert.equal(providerApplicationEligibilityError("Indefinite leave to remain / settled status", true), null);
  assert.equal(providerApplicationEligibilityError("Refugee", true), null);
});

test("only self-employed professionals can finalize the partnership", () => {
  assert.equal(canFinalizeProviderPartnership(true), true);
  assert.equal(canFinalizeProviderPartnership(false), false);
  assert.equal(canFinalizeProviderPartnership("agree"), false);
});

test("professional passwords require eight characters and a full character mix", () => {
  assert.equal(isStrongProviderPassword("Clean#123"), true);
  assert.equal(isStrongProviderPassword("clean#123"), false);
  assert.equal(isStrongProviderPassword("CLEAN#123"), false);
  assert.equal(isStrongProviderPassword("Cleaner12"), false);
  assert.equal(isStrongProviderPassword("Cl#1"), false);
});

test("cleaning experience accepts the displayed experience choices", () => {
  assert.equal(isProviderCleaningExperienceYears(0), true);
  assert.equal(isProviderCleaningExperienceYears(60), true);
  assert.equal(isProviderCleaningExperienceYears(61), false);
  assert.equal(
    isProviderCleaningExperienceTypes(["Domestic cleaning", "Office cleaning"]),
    true,
  );
  assert.equal(isProviderCleaningExperienceTypes([]), false);
  assert.equal(isProviderCleaningExperienceTypes(["Window washing only"]), false);
});

test("travel distance only accepts an application option", () => {
  assert.equal(isProviderTravelDistance("Up to 10 miles"), true);
  assert.equal(isProviderTravelDistance("Anywhere"), false);
});

test("weekly availability requires all seven days and at least one working period", () => {
  const availability = {
    monday: "morning",
    tuesday: "unavailable",
    wednesday: "afternoon",
    thursday: "unavailable",
    friday: "all_day",
    saturday: "evening",
    sunday: "unavailable",
  } as const;
  assert.equal(isProviderWeeklyAvailability(availability), true);
  assert.equal(
    isProviderWeeklyAvailability({ ...availability, monday: "overnight" }),
    false,
  );
  assert.equal(
    isProviderWeeklyAvailability({
      monday: "unavailable",
      tuesday: "unavailable",
      wednesday: "unavailable",
      thursday: "unavailable",
      friday: "unavailable",
      saturday: "unavailable",
      sunday: "unavailable",
    }),
    false,
  );
  assert.deepEqual(providerAvailabilityRows(availability), [
    { weekday: 1, start_time: "07:00", end_time: "12:00" },
    { weekday: 3, start_time: "12:00", end_time: "17:00" },
    { weekday: 5, start_time: "07:00", end_time: "20:00" },
    { weekday: 6, start_time: "17:00", end_time: "20:00" },
  ]);
});
