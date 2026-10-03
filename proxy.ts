import { updateSession } from "@/lib/supabase/proxy";
import { NextResponse, type NextRequest } from "next/server";
import { handymanEnabled, isHandymanMarketplacePath } from "@/lib/handymanMarketplace";

export async function proxy(request: NextRequest) {
  // Stop before Next streams the disabled layout, which can otherwise yield 200.
  if (isHandymanMarketplacePath(request.nextUrl.pathname) && !handymanEnabled()) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
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
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
