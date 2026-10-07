import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { canUseProfessionalTools } from "../professionalAccess";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });
  const PUBLIC = [
    "/api",
    "/login",
    "/book",
    "/services",
    "/coming-soon",
    "/subscribe",
    "/providers",
    "/reviews",
    "/blog",
    "/faq",
    "/legal",
    "/provider",
    "/account",
    "/worker",
    "/notifications",
  ];
  const publicPath = request.nextUrl.pathname === "/staff/login" || PUBLIC.some((p) =>
    request.nextUrl.pathname.startsWith(p)
  );
  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  // Check direct URLs and RSC navigation, while keeping evidence submission open.
  if (request.nextUrl.pathname === "/worker" || request.nextUrl.pathname.startsWith("/worker/")) {
    let destination: string | null = null;
    if (!user?.sub) destination = "/provider/login";
    else {
      const { data: provider } = await supabase.from("providers").select("id,vetting_status,is_suspended").eq("profile_id", user.sub).maybeSingle();
      if (!provider) destination = "/provider/join";
      else if (!canUseProfessionalTools(provider) && !["/worker/application", "/worker/profile"].includes(request.nextUrl.pathname)) destination = "/worker/application";
    }
    if (destination) {
      const url = request.nextUrl.clone(); url.pathname = destination; url.search = "";
      const response = NextResponse.redirect(url);
      for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie);
      return response;
    }
  }

  if (
    request.nextUrl.pathname !== "/" &&
    !publicPath &&
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone();
    url.pathname = request.nextUrl.pathname.startsWith("/admin")
      ? "/staff/login"
      : "/auth/login";
    return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
