import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingNotesForHome,
  parseCleaningHome,
  recommendedCleaningMinutesForHome,
  splitBookingHomeNotes,
} from "./cleaningHome";

test("the client's room details suggest time without exceeding eight hours", () => {
  const studio = parseCleaningHome({
    propertyType: "studio",
    bedrooms: 0,
    bathrooms: 1,
  });
  const house = parseCleaningHome({
    propertyType: "house",
    bedrooms: 3,
    bathrooms: 2,
  });
  const large = parseCleaningHome({
    propertyType: "house",
    bedrooms: 8,
    bathrooms: 8,
  });
  assert.ok(studio && house && large);
  assert.equal(recommendedCleaningMinutesForHome(studio), 120);
  assert.equal(recommendedCleaningMinutesForHome(house), 240);
  assert.equal(recommendedCleaningMinutesForHome(large), 480);
});

test("incomplete or impossible room details are rejected", () => {
  assert.equal(
    parseCleaningHome({ propertyType: "flat", bedrooms: "", bathrooms: 1 }),
    null,
  );
  assert.equal(
    parseCleaningHome({ propertyType: "studio", bedrooms: 1, bathrooms: 1 }),
    null,
  );
  assert.equal(
    parseCleaningHome({ propertyType: "house", bedrooms: 2, bathrooms: 0 }),
    null,
  );
});

test("Essential Clean's larger-home guide does not impose a new booking minimum or alter other sessions", () => {
  const smaller = { propertyType: "flat", bedrooms: 2, bathrooms: 1 } as const;
  const larger = { propertyType: "flat", bedrooms: 3, bathrooms: 1 } as const;
  assert.equal(
    recommendedCleaningMinutesForHome(smaller, "Essential Clean"),
    150,
  );
  assert.equal(
    recommendedCleaningMinutesForHome(larger, "Essential Clean"),
    240,
  );
  assert.equal(
    recommendedCleaningMinutesForHome(larger, "One-Time Essential Clean"),
    180,
  );
  assert.equal(
    recommendedCleaningMinutesForHome(
      { propertyType: "house", bedrooms: 8, bathrooms: 8 },
      "Essential Clean",
    ),
    480,
  );
});

test("room details and requests survive the existing booking notes field", () => {
  const home = parseCleaningHome({
    propertyType: "flat",
    bedrooms: 2,
    bathrooms: 1,
  });
  assert.ok(home);
  const saved = bookingNotesForHome(
    home,
    "  Please clean the kitchen first.  ",
  );
  assert.deepEqual(splitBookingHomeNotes(saved), {
    home: "Flat, 2 bedrooms, 1 bathroom",
    request: "Please clean the kitchen first.",
  });
  assert.deepEqual(splitBookingHomeNotes("Legacy note"), {
    home: null,
    request: "Legacy note",
  });
});
