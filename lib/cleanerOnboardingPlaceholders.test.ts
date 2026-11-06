import assert from "node:assert/strict";
import test from "node:test";
import {
  CLEANER_ONBOARDING_MISSING_SOURCES as sources,
  pendingOnboardingWording,
  requirePublishedOnboardingWording,
} from "./cleanerOnboardingPlaceholders";

test("approved wording metadata records source and version centrally", () => {
  assert.equal(
    pendingOnboardingWording("applicationReceived"),
    "[Onboarding Process 9.1 – Version 1.0 – effective 1 October 2026]",
  );
  assert.equal(
    pendingOnboardingWording("applicationRejected"),
    "[Onboarding Process 9.3 – Version 1.0 – effective 1 October 2026]",
  );
  for (const entry of Object.values(sources)) {
    assert.ok(entry.reference.length);
    assert.ok(entry.wording.length);
    assert.equal(entry.status, "approved");
    assert.equal(entry.version, "1.0");
  }
});
test("placeholder text cannot become applicant email even if accidentally marked published", () => {
  for (const entry of Object.values(sources).filter(
    (entry) => entry.kind === "email",
  ))
    assert.throws(
      () =>
        requirePublishedOnboardingWording({
          wording: entry.wording,
          version: "1.0",
          published: true,
          approvalStatus: "approved",
        }),
      /awaiting/,
    );
});
test("unpublished and unversioned wording is held; an explicit fictional approved template is usable", () => {
  const input = {
    wording: "TEST ONLY fictional template",
    version: "TEST-1",
    published: true,
    approvalStatus: "approved" as const,
  };
  assert.equal(requirePublishedOnboardingWording(input), input.wording);
  assert.throws(() =>
    requirePublishedOnboardingWording({ ...input, published: false }),
  );
  assert.throws(() =>
    requirePublishedOnboardingWording({ ...input, version: "" }),
  );
  assert.throws(() =>
    requirePublishedOnboardingWording({ ...input, wording: " " }),
  );
  assert.throws(() =>
    requirePublishedOnboardingWording({ ...input, approvalStatus: "draft" }),
  );
  assert.throws(() =>
    requirePublishedOnboardingWording({ ...input, approvalStatus: undefined }),
  );
  assert.throws(() =>
    requirePublishedOnboardingWording({
      ...input,
      wording: "Hello {{first_name}}",
    }),
  );
});
