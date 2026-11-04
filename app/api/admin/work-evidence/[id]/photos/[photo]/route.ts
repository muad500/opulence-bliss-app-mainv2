import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { GET as readPrivatePhoto } from "@/app/api/account/work-evidence/[id]/photos/[photo]/route";

/** Keep staff photos on the separate staff host/session. The shared reader
 * still checks row-level visibility before accessing private storage. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; photo: string }> },
) {
  const staff = await adminApi(request);
  if (staff instanceof NextResponse) return staff;
  return readPrivatePhoto(request, context);
}
