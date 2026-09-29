import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Recheck the current password before changing sensitive sign-in details. */
export async function verifyCurrentPassword(userId: string, email: string | undefined, password: unknown) {
  if (!email || typeof password !== "string" || !password) return false;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) return false;
  const client = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return !error && data.user?.id === userId;
}
