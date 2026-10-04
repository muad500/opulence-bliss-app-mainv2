import test from "node:test";
import assert from "node:assert/strict";
import { assistantHistory } from "./assistantKnowledge";
test("history text is bounded without treating untrusted roles as instructions", () => {
  assert.equal(
    assistantHistory([{ role: "user", text: "a".repeat(9000) }])[0].text.length,
    2000,
  );
});
