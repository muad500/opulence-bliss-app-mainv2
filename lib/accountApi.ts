import { createClient as createAdminClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export type AccountContext = {
  user: User;
  admin: SupabaseClient;
  providerId: string | null;
};

export function accountError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function isSameOriginMutation(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== request.nextUrl.origin) return false;
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

export async function accountContext(
  request: NextRequest,
  options: { provider?: boolean; mutation?: boolean } = {},
): Promise<AccountContext | NextResponse> {
  if (options.mutation && !isSameOriginMutation(request)) {
    return accountError("This request must come from the website.", 403);
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return accountError("Please sign in again.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return accountError("Account service is unavailable.", 503);
  const admin = createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) return accountError("Account could not be loaded.", 503);
  if (!profile || profile.role === "admin") return accountError("This account area is unavailable.", 403);
  const { data: provider, error: providerError } = await admin
    .from("providers")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (providerError) return accountError("Account could not be loaded.", 503);
  if (options.provider && !provider) return accountError("Professional profile not found.", 403);
  return { user, admin, providerId: provider?.id ?? null };
}

export function isAccountError(value: AccountContext | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export async function readAccountBody(request: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return accountError("Send JSON account details.", 415);
  }
  const raw = await request.text();
  if (raw.length > 20000) return accountError("The account update is too large.", 413);
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : accountError("Invalid account details.");
  } catch {
    return accountError("Invalid JSON.");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Enter text in the requested field.");
  const text = value.trim();
  if (text.length > max) throw new Error(`Keep this field under ${max} characters.`);
  return text || null;
}

export function textList(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string" || item.trim().length > maxLength)) {
    throw new Error("Enter a shorter list of values.");
  }
  return [...new Set(value.map((item: string) => item.trim()).filter(Boolean))];
}

export function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error("Choose yes or no.");
  return value;
}

export function optionalInteger(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`Enter a number between ${min} and ${max}.`);
  }
  return Number(value);
}

export function normaliseGbPhone(value: unknown): string | null | undefined {
  const text = optionalText(value, 30);
  if (text === undefined || text === null) return text;
  const parsed = parsePhoneNumberFromString(text, "GB");
  if (!parsed || parsed.country !== "GB" || !parsed.isValid()) throw new Error("Enter a valid UK phone number.");
  return parsed.number;
}

export function optionalDate(value: unknown): string | null | undefined {
  const text = optionalText(value, 10);
  if (text === undefined || text === null) return text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error("Enter a valid date.");
  }
  return text;
}

export function safeProfilePhoto(value: unknown): string | null | undefined {
  const text = optionalText(value, 1000);
  if (!text) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new Error("Use a secure photo URL.");
  }
}
