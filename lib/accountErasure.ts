import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Resumable: don't mark the request complete until Auth and storage succeed. */
export async function eraseReviewedAccount(admin: SupabaseClient, requestId: string, retentionNote: string) {
  const { data, error } = await admin.rpc("prepare_account_erasure", { p_request_id: requestId, p_retention_note: retentionNote });
  if (error || !data?.userId) throw new Error(error?.message ?? "Account erasure could not start.");
  const files = data.files as { bucket: string; path: string }[];
  const groups = new Map<string, string[]>();
  for (const file of files) groups.set(file.bucket, [...(groups.get(file.bucket) ?? []), file.path]);
  for (const [bucket, paths] of groups) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error: removeError } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100));
      if (removeError) throw new Error("Private details were erased, but file cleanup needs a retry. Run this action again.");
    }
  }
  // Keep the non-identifying UUID needed by retained ledgers. Supabase removes
  // credentials and personal Auth fields; this cannot be reversed.
  const { data: lookup, error: lookupError } = await admin.auth.admin.getUserById(data.userId);
  if (lookupError && lookupError.status !== 404) throw new Error("Authentication cleanup needs a retry.");
  if (lookup?.user && !lookup.user.deleted_at) {
    const { error: authError } = await admin.auth.admin.deleteUser(data.userId, true);
    if (authError) throw new Error("Private details were erased, but sign-in cleanup needs a retry. Run this action again.");
  }
  const { error: requestError } = await admin.rpc("finish_account_erasure", { p_id: requestId, p_note: retentionNote });
  if (requestError) throw new Error("Account erasure finished, but recording the outcome needs a retry.");
}
