import { updateSession } from "@/lib/supabase/proxy";
import { NextResponse, type NextRequest } from "next/server";
import {
  handymanEnabled,
  isHandymanMarketplacePath,
} from "@/lib/handymanMarketplace";
import { adminHostRedirect, deploymentOrigins } from "@/lib/adminHosts";

export async function proxy(request: NextRequest) {
  let destination = adminHostRedirect(request.nextUrl, process.env);
  if (
    request.nextUrl.pathname === "/" &&
    request.nextUrl.origin === deploymentOrigins(process.env).admin
  ) {
    destination = request.nextUrl.clone();
    destination.pathname = "/staff/login";
  }
  if (destination)
    return NextResponse.redirect(destination, {
      status: 307,
      headers: { "Cache-Control": "no-store" },
    });
  // These legacy public URLs must run after host routing. Framework-configured
  // redirects run before this proxy and could trap a public page on the staff host.
  const legacy = new Map([
    ["/services/massage", "/services/cleaning"],
    ["/blog/benefits-of-massage-at-home", "/blog"],
  ]).get(request.nextUrl.pathname);
  if (legacy) {
    const target = request.nextUrl.clone();
    target.pathname = legacy;
    return NextResponse.redirect(target, 308);
  }
  // Keep public image files public, after enforcing staff-host routing. Excluding
  // image suffixes in the matcher would also skip /admin/customers/example.png.
  if (/\.(?:svg|png|jpg|jpeg|gif|webp)$/i.test(request.nextUrl.pathname))
    return NextResponse.next({ request });
  // Stop before Next streams the disabled layout, which can otherwise yield 200.
  if (
    isHandymanMarketplacePath(request.nextUrl.pathname) &&
    !handymanEnabled()
  ) {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     * Public images are handled above, after staff host enforcement.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
