const PRODUCTION_COOKIE_NAME = "sb-uiqcsihgqaktpjumyeap-auth-token";
const STAGING_COOKIE_NAME = "sb-comwdjprdedmsnxtvuuk-auth-token";

/** Session identifiers belong to the project, never to its API hostname. */
export function supabaseSessionOptions(supabaseUrl: string) {
  const hostname = new URL(supabaseUrl).hostname;
  let name: string;
  if (
    hostname === "auth.opulencebliss.com" ||
    hostname === "uiqcsihgqaktpjumyeap.supabase.co"
  ) {
    name = PRODUCTION_COOKIE_NAME;
  } else if (hostname === "comwdjprdedmsnxtvuuk.supabase.co") {
    name = STAGING_COOKIE_NAME;
  } else {
    throw new Error(
      "Supabase session storage is not configured for this host.",
    );
  }
  return { cookieOptions: { name }, auth: { storageKey: name } };
}
