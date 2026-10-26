import assert from "node:assert/strict";
import test from "node:test";
import { runDataRetention, type RetentionClient } from "./dataRetention";

function fixture(
  options: {
    hold?: boolean;
    failed?: boolean;
    rpcError?: boolean;
    thrown?: boolean;
  } = {},
) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const removed: string[] = [];
  const client: RetentionClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "run_data_retention")
        return { data: { failed: 0, dryRun: args?.p_dry_run }, error: null };
      if (name === "claim_retention_file_tasks")
        return {
          data: [
            {
              id: "private-task",
              claimToken: "private-lease",
              files: [{ bucket: "provider-dbs", path: "private-document" }],
            },
          ],
          error: null,
        };
      if (name === "remove_retention_file_task") {
        if (options.thrown) throw Error("Private provider response");
        return {
          data: options.hold
            ? "held_or_obsolete"
            : options.failed || options.thrown
              ? "retry"
              : "done",
          error: options.rpcError ? { private: true } : null,
        };
      }
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        remove: async (paths) => {
          removed.push(...paths);
          if (options.thrown) throw Error("Private provider response");
          return { error: options.failed ? { private: true } : null };
        },
      }),
    },
  };
  return { client, calls, removed };
}

test("dry run never claims or removes files", async () => {
  const f = fixture();
  await runDataRetention(f.client);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["run_data_retention"],
  );
  assert.equal(f.removed.length, 0);
});

test("file removal is preceded by a hold and lease recheck", async () => {
  const f = fixture();
  const result = await runDataRetention(f.client, false);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    [
      "run_data_retention",
      "claim_retention_file_tasks",
      "remove_retention_file_task",
    ],
  );
  assert.equal(result.filesCompleted, 1);
  assert.equal(f.removed.length, 0);
});

test("a newly opened hold prevents Storage deletion and metadata completion", async () => {
  const f = fixture({ hold: true });
  await runDataRetention(f.client, false);
  assert.equal(f.removed.length, 0);
  assert.equal(
    f.calls.some((c) => c.name === "finish_retention_file_task"),
    false,
  );
});

for (const options of [{ failed: true }, { thrown: true }]) {
  test(`Storage ${options.thrown ? "exception" : "failure"} leaves a retryable task`, async () => {
    const f = fixture(options);
    const result = await runDataRetention(f.client, false);
    assert.equal(result.filesFailed, 1);
    assert.equal(result.filesCompleted, 0);
    assert.equal(f.removed.length, 0);
    assert.equal(JSON.stringify(result).includes("Private"), false);
  });
}

test("an unknown hold-check result fails closed and reports failure", async () => {
  const f = fixture({ rpcError: true });
  const result = await runDataRetention(f.client, false);
  assert.equal(f.removed.length, 0);
  assert.equal(result.filesFailed, 1);
});
