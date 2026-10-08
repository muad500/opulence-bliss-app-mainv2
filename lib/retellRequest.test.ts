import assert from "node:assert/strict";
import { test } from "node:test";
import { Retell } from "retell-sdk";
import { verifiedRetellRequest } from "./retellRequest";

const key = "local-test-only-retell-key";
const raw = JSON.stringify({ name: "get_cleaning_services", call: { agent_id: "agent_test", call_id: "call_test_12345678" }, args: {} });

test("Retell signature validates the exact body and configured receptionist", async () => {
  const signature = await Retell.sign(raw, key);
  const result = await verifiedRetellRequest(raw, signature, key, "agent_test");
  assert.equal(result.name, "get_cleaning_services");
  assert.equal(result.callId, "call_test_12345678");
  await assert.rejects(verifiedRetellRequest(raw + " ", signature, key, "agent_test"), /signature/);
  await assert.rejects(verifiedRetellRequest(raw, signature, key, "agent_other"), /authorised/);
  await assert.rejects(verifiedRetellRequest(raw, null, key, "agent_test"), /signature/);
  await assert.rejects(verifiedRetellRequest(raw, signature, undefined, "agent_test"), /configured/);
});

test("expired signatures and args-only payloads are refused", async () => {
  const digest = await import("node:crypto");
  const stamp = Date.now() - 60 * 60 * 1000;
  const signature = `v=${stamp},d=${digest.createHmac("sha256", key).update(raw + stamp).digest("hex")}`;
  await assert.rejects(verifiedRetellRequest(raw, signature, key, "agent_test"), /signature/);
  const argsOnly = JSON.stringify({ service_id: "x" });
  await assert.rejects(verifiedRetellRequest(argsOnly, await Retell.sign(argsOnly, key), key, "agent_test"), /authorised/);
});
