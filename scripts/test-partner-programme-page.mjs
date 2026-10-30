import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseDocument } from "htmlparser2";
import { findAll, textContent } from "domutils";
const require = createRequire(import.meta.url),
  cache = new Map();
function load(file) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const compiledModule = { exports: {} };
  cache.set(absolute, compiledModule);
  const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const scopedRequire = (id) => {
    if (id === "next/link")
      return {
        __esModule: true,
        default: (props) => {
          const { prefetch, ...anchorProps } = props;
          void prefetch;
          return React.createElement("a", anchorProps);
        },
      };
    if (id.endsWith(".css")) return { page: "partner-page-test" };
    if (id.startsWith("@/") || id.startsWith(".")) {
      const base = id.startsWith("@/")
        ? path.resolve(id.slice(2))
        : path.resolve(path.dirname(absolute), id);
      const target = [
        base,
        base + ".ts",
        base + ".tsx",
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
      ].find((p) => existsSync(p));
      if (!target) throw Error(id);
      return load(target);
    }
    return require(id);
  };
  new Function("module", "exports", "require", code)(
    compiledModule,
    compiledModule.exports,
    scopedRequire,
  );
  return compiledModule.exports;
}
const config = load("lib/partnerProgrammeConfig.ts");
function page() {
  return parseDocument(
    renderToStaticMarkup(
      React.createElement(load("app/partners/PartnerPageContent.tsx").default),
    ),
  );
}
function visibleCopy(node) {
  if (node.type === "text") return node.data;
  if (
    node.name === "svg" ||
    node.attribs?.class
      ?.split(" ")
      .some((c) => ["calc", "err", "preview", "thanks", "honeypot"].includes(c))
  )
    return "";
  const inside = node.children?.map(visibleCopy).join("") || "";
  return [
    "section",
    "div",
    "p",
    "h1",
    "h2",
    "h3",
    "li",
    "ul",
    "ol",
    "table",
    "tr",
    "th",
    "td",
    "label",
    "form",
    "details",
    "summary",
    "button",
    "a",
  ].includes(node.name)
    ? " " + inside + " "
    : inside;
}
const normalize = (value) => value.replace(/\s+/g, " ").trim();
test("every approved section stays in order and every visible static word is unchanged", () => {
  const approved = JSON.parse(
    readFileSync("app/partners/approved-copy.json", "utf8"),
  );
  const actual = findAll((n) => n.name === "section", page().children).map(
    (n) => ({ id: n.attribs.id || "hero", text: normalize(visibleCopy(n)) }),
  );
  assert.deepEqual(
    actual,
    approved.filter((s) => s.id !== "loyalty"),
  );
});
test("loyalty promises are absent until the explicit off setting is changed", () => {
  assert.equal(config.PARTNER_LOYALTY_ENABLED, false);
  const rendered = renderToStaticMarkup(
    React.createElement(load("app/partners/PartnerPageContent.tsx").default),
  );
  assert.doesNotMatch(
    rendered,
    /2 hrs free|5% off|id="loyalty"|Design preview/,
  );
});
test("the shared reward contract and displayed reward copy agree", () => {
  assert.deepEqual(config.PARTNER_PROGRAMME, {
    householdRewardPence: [500, 500],
    householdDiscountPence: [500, 500],
    businessInitialPercent: 5,
    businessEstablishedPercent: 10,
    businessInitialCount: 3,
    businessTrialWeeks: 4,
    businessTermMonths: 12,
  });
  assert.equal(
    config.partnerProgrammeCopy(
      "{{rewardFirst}} + {{rewardSecond}} / {{discountFirst}} + {{discountSecond}} / {{initialPercent}} / {{establishedPercent}} / {{termMonths}} / {{trialWeeks}}",
    ),
    "£5 + £5 / £5 + £5 / 5% / 10% / 12 / 4",
  );
  // The exact-copy snapshot above intentionally fails if these values change without approved copy changes.
  assert.throws(
    () => config.partnerProgrammeCopy("{{unrecognised}}"),
    /Unknown Partner copy value/,
  );
});
test("calculator matches the approved client algorithm across slider boundaries", () => {
  for (const households of [0, 1, 3, 10, 20, 50, 100])
    for (const percent of [0, 5, 45, 50, 70, 95, 100])
      for (const businesses of [0, 1, 3, 4, 5, 12])
        for (const fee of [200, 800, 1450, 3000]) {
          const second = Math.round((households * percent) / 100),
            householdReward = households * 5 + second * 5;
          let businessReward = 0;
          for (let i = 1; i <= businesses; i++)
            businessReward += (fee * (i <= 3 ? 5 : 10)) / 100;
          const actual = config.calculatePartnerIllustration({
            households,
            secondBookingPercent: percent,
            businesses,
            businessMonthlyFee: fee,
          });
          assert.equal(actual.secondBookings, second);
          assert.equal(actual.householdReward, householdReward);
          assert.equal(actual.householdDiscount, householdReward);
          assert.equal(actual.businessReward, businessReward);
          assert.equal(actual.total, householdReward + businessReward);
        }
  const normal = config.calculatePartnerIllustration({
    households: 20,
    secondBookingPercent: 70,
    businesses: 4,
    businessMonthlyFee: 800,
  });
  assert.equal(normal.total, 370);
});
test("default calculator output, preset values, fee/trial small print and privacy form match the source", () => {
  const doc = page(),
    body = textContent(doc);
  assert.match(body, /£370/);
  assert.match(body, /Households \(20, 14 with a second booking\)/);
  assert.match(body, /Businesses \(4, 10% from the 4th\)/);
  assert.match(
    body,
    /Your households would save £170 between them, as £5 off their first and second bookings\./,
  );
  const form = findAll((n) => n.name === "form", doc.children)[0],
    inputs = findAll((n) => n.name === "input", form.children);
  assert.equal(
    inputs.find((n) => n.attribs.name === "consent").attribs.checked,
    undefined,
  );
  assert.ok(
    inputs.find((n) => n.attribs.name === "consent").attribs.required !==
      undefined,
  );
  assert.ok(
    findAll(
      (n) => n.name === "a" && n.attribs.href === "/legal/privacy",
      form.children,
    ).length,
  );
  assert.ok(
    findAll(
      (n) => n.name === "a" && n.attribs.href === "/provider/join",
      doc.children,
    ).some((n) => textContent(n) === "Visit the cleaner page"),
  );
  assert.equal(
    findAll(
      (n) => n.name === "a" && /Partner Programme Terms/.test(textContent(n)),
      doc.children,
    ).length,
    1,
  );
});
test("the Partner page adds no external loads, trackers, storage or cookies", () => {
  for (const file of [
    "app/partners/page.tsx",
    "app/partners/PartnerPageContent.tsx",
    "app/partners/PartnerCalculator.tsx",
    "app/partners/PartnerInterestForm.tsx",
    "app/partners/PartnerShareMessage.tsx",
    "components/PartnerIllustrations.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /https?:\/\/|localStorage|sessionStorage|document\.cookie|next\/font\/google|fonts\.google|<iframe/,
    );
  }
  const doc = page();
  assert.equal(
    findAll(
      (n) =>
        ["script", "iframe"].includes(n.name) ||
        (n.name === "img" && /^https?:/.test(n.attribs.src || "")),
      doc.children,
    ).length,
    0,
  );
});
