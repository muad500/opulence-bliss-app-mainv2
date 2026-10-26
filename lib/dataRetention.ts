export const retentionRules = [
  ["emergency_contacts", "Emergency contacts", "6 months after leaving"],
  ["dbs_outcomes", "DBS outcomes", "6 months after account closure"],
  ["dbs_copies", "DBS certificate copies", "At most 6 months from upload"],
  ["check_ins", "Check-in records", "2 years"],
  ["messages", "Chat messages", "2 years"],
  ["job_photos", "Job photos", "12 months after the job ends"],
  [
    "unsuccessful_applicants",
    "Unsuccessful applications",
    "6 months after rejection",
  ],
  ["enquiries", "Enquiries", "12 months"],
  [
    "incidents",
    "Safeguarding, complaints and incidents",
    "6 years after resolution",
  ],
  ["business_records", "Business records", "6 years after the contract ends"],
  [
    "access_instructions",
    "Access codes and instructions",
    "When the series or contract ends",
  ],
] as const;

export type RetentionFile = { bucket: string; path: string };
export type RetentionTask = {
  id: string;
  claimToken: string;
  files: RetentionFile[];
};

type RpcResult = { data: unknown; error: unknown };
export type RetentionClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
    };
  };
};

/** Never log a path, personal value, credential or the provider's error body. */
export async function runDataRetention(
  client: RetentionClient,
  dryRun = true,
): Promise<
  Record<string, unknown> & { filesCompleted: number; filesFailed: number }
> {
  const sweep = await client.rpc("run_data_retention", { p_dry_run: dryRun });
  if (sweep.error) throw new Error("Retention sweep needs attention.");
  const summary = sweep.data as Record<string, unknown>;
  if (dryRun) return { ...summary, filesCompleted: 0, filesFailed: 0 };

  const claimed = await client.rpc("claim_retention_file_tasks", {
    p_limit: 40,
  });
  if (claimed.error) throw new Error("Retention file queue needs attention.");
  let filesCompleted = 0;
  let filesFailed = 0;
  for (const task of (claimed.data ?? []) as RetentionTask[]) {
    // Storage and metadata cleanup share the database's case/hold lock. The
    // caller receives only a fixed status, never file contents or credentials.
    try {
      const result = await client.rpc("remove_retention_file_task", {
        p_id: task.id,
        p_token: task.claimToken,
      });
      if (result.error || result.data === "retry") filesFailed++;
      else if (result.data === "done") filesCompleted++;
    } catch {
      filesFailed++;
    }
  }
  return { ...summary, filesCompleted, filesFailed };
}
