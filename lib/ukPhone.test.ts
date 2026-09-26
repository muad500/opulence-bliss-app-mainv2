import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUkPhone, isStoredUkPhone, isValidUkPhone, normalizeUkPhone } from "./ukPhone";

test("typed numbers are validated without the +44 prefix", () => {
  assert.equal(isValidUkPhone("7912345678"), true);
  assert.equal(isValidUkPhone("7912 345678"), true);
  assert.equal(isValidUkPhone(""), false);
});

test("the typed-input check rejects a stored number", () => {
  assert.equal(isValidUkPhone("+447912345678"), false);
});

test("stored numbers are recognised", () => {
  assert.equal(isStoredUkPhone(normalizeUkPhone("7912345678")), true);
  assert.equal(isStoredUkPhone("+447912345678"), true);
});

test("missing or malformed stored numbers are not", () => {
  assert.equal(isStoredUkPhone(null), false);
  assert.equal(isStoredUkPhone(""), false);
  assert.equal(isStoredUkPhone("+44"), false);
  assert.equal(isStoredUkPhone("07912345678"), false);
  assert.equal(isStoredUkPhone("+4479123456"), false);
});

test("stored numbers are formatted for display", () => {
  assert.equal(formatUkPhone("+447912345678"), "+44 7912 345678");
  assert.equal(formatUkPhone("something else"), "something else");
});
