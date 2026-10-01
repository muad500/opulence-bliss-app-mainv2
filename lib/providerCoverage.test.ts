import assert from "node:assert/strict";
import test from "node:test";
import { coversServicePostcode, servicePostcodeFromText } from "./providerCoverage";

test("service postcode is found in a full booking address or postcode-only visit", () => {
  assert.equal(servicePostcodeFromText("12 Example Road, London, SW3 1AA"), "SW31AA");
  assert.equal(servicePostcodeFromText("sw3 1aa"), "SW31AA");
  assert.equal(servicePostcodeFromText("12 Example Road, London"), null);
});

test("saved outward and full postcodes narrow professional matching", () => {
  assert.equal(coversServicePostcode(["sw3"], "SW3 1AA"), true);
  assert.equal(coversServicePostcode(["SW3 1AA"], "12 Example Road, SW3 1AA"), true);
  assert.equal(coversServicePostcode(["SW3 2BB"], "SW3 1AA"), false);
  assert.equal(coversServicePostcode(["SW30"], "SW3 1AA"), false);
  assert.equal(coversServicePostcode(["SW3"], "W8 1AA"), false);
  assert.equal(coversServicePostcode([], "W8 1AA"), true);
  assert.equal(coversServicePostcode(["SW3"], "No postcode supplied"), true);
});
