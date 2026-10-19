import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_PREVIEW_LIMIT,
  ADMIN_PAGE_SIZE,
  adminPageNumber,
  adminListHref,
  pendingProfessionalFilter,
  professionalStatus,
} from "./adminDashboard";
test("admin overview has five-item previews and bounded 20-item full pages", () => {
  assert.equal(ADMIN_PREVIEW_LIMIT, 5);
  assert.equal(ADMIN_PAGE_SIZE, 20);
});
test("invalid pagination safely falls back to page one", () => {
  for (const value of [
    undefined,
    "0",
    "-1",
    "1.2",
    "12e2",
    "garbage",
    "999999",
    "2x",
  ])
    assert.equal(adminPageNumber(value), 1);
  assert.equal(adminPageNumber("3"), 3);
});
test("filters survive pagination and filter changes can reset to page one", () => {
  assert.equal(
    adminListHref("/admin/cleaners", 2, { status: "pending" }),
    "/admin/cleaners?status=pending&page=2",
  );
  assert.equal(
    adminListHref("/admin/reviews/activity", 1, { type: undefined }),
    "/admin/reviews/activity",
  );
});
test("approval queries match only visible services", () => {
  assert.equal(
    pendingProfessionalFilter(false),
    "service_approvals->>cleaning.eq.pending",
  );
  assert.match(pendingProfessionalFilter(true), /handyman/);
});
test("rejected or suspended providers are not labelled as awaiting review", () => {
  assert.equal(professionalStatus("rejected").label, "Rejected");
  assert.equal(professionalStatus("approved", true).label, "Suspended");
  assert.equal(professionalStatus("pending").label, "Awaiting review");
});
