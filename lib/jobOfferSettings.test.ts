import test from "node:test";
import assert from "node:assert/strict";
import { offerOutcode, parseJobOfferSettings } from "./jobOfferSettings";

test("offer settings require bounded whole numbers and a version", () => {
  assert.deepEqual(
    parseJobOfferSettings({
      firstWaveSize: 5,
      secondWaveAfterMinutes: 10,
      version: 1,
    }),
    { firstWaveSize: 5, secondWaveAfterMinutes: 10, version: 1 },
  );
  for (const firstWaveSize of [0, -1, 1.5, 101, "5", null])
    assert.throws(() =>
      parseJobOfferSettings({
        firstWaveSize,
        secondWaveAfterMinutes: 10,
        version: 1,
      }),
    );
  for (const secondWaveAfterMinutes of [0, -1, 0.5, 1441, "10", null])
    assert.throws(() =>
      parseJobOfferSettings({
        firstWaveSize: 5,
        secondWaveAfterMinutes,
        version: 1,
      }),
    );
  assert.throws(() =>
    parseJobOfferSettings({ firstWaveSize: 5, secondWaveAfterMinutes: 10 }),
  );
});

test("location lookup extracts only a public outward district", () => {
  assert.equal(offerOutcode("Private home, SW1A 1AA"), "SW1A");
  assert.equal(offerOutcode("ec1v2nx"), "EC1V");
  assert.equal(offerOutcode(" ze1 "), "ZE1");
  assert.equal(offerOutcode("Private home with no valid postcode"), null);
  assert.equal(offerOutcode(null), null);
});
