import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SOCIAL_LINKS,
  parseSocialLinks,
  socialLinksFromRows,
} from "./socialLinks";

test("social links keep current defaults and Nextdoor unset", () => {
  assert.deepEqual(socialLinksFromRows([]), DEFAULT_SOCIAL_LINKS);
  assert.equal(DEFAULT_SOCIAL_LINKS.nextdoor, "");
});
test("admin can update a page or clear a link without restoring the default", () => {
  const links = socialLinksFromRows([
    { platform: "facebook", url: null },
    {
      platform: "nextdoor",
      url: "https://nextdoor.co.uk/pages/opulencebliss/",
    },
  ]);
  assert.equal(links.facebook, "");
  assert.equal(links.nextdoor, "https://nextdoor.co.uk/pages/opulencebliss/");
  assert.equal(
    parseSocialLinks({
      ...links,
      instagram: " https://instagram.com/new-page ",
    }).instagram,
    "https://instagram.com/new-page",
  );
});
test("social URLs reject unsafe schemes, credentials and unrelated hosts", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://facebook.com/page",
    "https://facebook.com.attacker.test",
    "https://attackerfacebook.com",
    "https://user:pass@facebook.com/page",
    "https://facebook.com:8443/page",
    "//facebook.com/page",
  ]) {
    assert.throws(() =>
      parseSocialLinks({ ...DEFAULT_SOCIAL_LINKS, facebook: url }),
    );
  }
  assert.throws(() =>
    parseSocialLinks({
      ...DEFAULT_SOCIAL_LINKS,
      instagram: "https://facebook.com/page",
    }),
  );
});
test("social settings require all four fields and bounded string inputs", () => {
  for (const value of [
    null,
    [],
    {},
    { ...DEFAULT_SOCIAL_LINKS, facebook: null },
    { ...DEFAULT_SOCIAL_LINKS, facebook: "a".repeat(2049) },
  ]) {
    assert.throws(() => parseSocialLinks(value));
  }
});
