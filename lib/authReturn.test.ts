import assert from "node:assert/strict";
import test from "node:test";
import { authLink, safeAuthNext } from "./authReturn";

test("the booking return survives each sign-up/sign-in link without leaving the site", () => {
  const next = "/book?resume=opaque-token";
  for (const page of ["/login", "/auth/sign-up", "/auth/sign-up-success"]) {
    const link = new URL(authLink(page, next), "https://www.opulencebliss.com");
    assert.equal(link.searchParams.get("next"), next);
    assert.equal(safeAuthNext(link.searchParams.get("next")), next);
  }
  for (const value of [
    null,
    "https://other.example",
    "//other.example",
    "/\\other.example",
    "/\n/other.example",
    "javascript:alert(1)",
  ]) {
    assert.equal(safeAuthNext(value), null);
    assert.equal(authLink("/login", value), "/login");
  }
});
