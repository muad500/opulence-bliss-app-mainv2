import { test } from "node:test";
import { strict as assert } from "node:assert";
import { handymanEstimatePence } from "./handymanEstimate";
test("handyman estimates use the professional's rate and round to a penny", () => {
  assert.equal(handymanEstimatePence(3500, 2.5), 8750);
  assert.equal(handymanEstimatePence(1699, .5), 850);
});
test("impossible hours and untrusted rates cannot produce an estimate", () => {
  for (const hours of [0, -1, 17, .75, Infinity, NaN, '2']) assert.equal(handymanEstimatePence(3500, hours), null);
  assert.equal(handymanEstimatePence(99, 2), null);
});
