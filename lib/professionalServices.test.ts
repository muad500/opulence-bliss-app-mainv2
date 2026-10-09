import assert from "node:assert/strict";
import { test } from "node:test";
import {
  serviceApproved,
  selectedProfessionalServices,
  visibleProfessionalServices,
} from "./professionalServices";

test("adding a pending service leaves approved cleaning available", () => {
  const provider = {
    vetting_status: "approved",
    is_suspended: false,
    service_approvals: {
      cleaning: "approved" as const,
      handyman: "pending" as const,
    },
  };
  assert.equal(serviceApproved(provider, "cleaning"), true);
  assert.equal(serviceApproved(provider, "handyman"), false);
  assert.equal(
    serviceApproved({ ...provider, is_suspended: true }, "cleaning"),
    false,
  );
});

test("service suspension affects only that service", () => {
  const provider = {
    vetting_status: "approved",
    is_suspended: false,
    service_approvals: {
      cleaning: "suspended" as const,
      handyman: "approved" as const,
    },
  };
  assert.equal(serviceApproved(provider, "cleaning"), false);
  assert.equal(serviceApproved(provider, "handyman"), true);
});

test("one application can select cleaning, handyman or both when enabled", () => {
  assert.deepEqual(
    selectedProfessionalServices(["cleaning", "handyman"], true),
    ["cleaning", "handyman"],
  );
  assert.deepEqual(selectedProfessionalServices(["handyman"], true), [
    "handyman",
  ]);
  assert.equal(selectedProfessionalServices([], true), null);
  assert.equal(
    selectedProfessionalServices(["cleaning", "gardening"], true),
    null,
  );
});

test("the disabled marketplace cannot be selected or displayed", () => {
  assert.deepEqual(
    visibleProfessionalServices(["cleaning", "handyman"], false),
    ["cleaning"],
  );
  assert.equal(selectedProfessionalServices(["handyman"], false), null);
  assert.equal(
    selectedProfessionalServices(["cleaning", "handyman"], false),
    null,
  );
});
