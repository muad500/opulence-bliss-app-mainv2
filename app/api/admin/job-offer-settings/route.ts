import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { parseJobOfferSettings } from "@/lib/jobOfferSettings";

function present(row: {
  first_wave_size: number;
  second_wave_after_minutes: number;
  version: number;
}) {
  return {
    firstWaveSize: row.first_wave_size,
    secondWaveAfterMinutes: row.second_wave_after_minutes,
    version: row.version,
  };
}

export async function GET(request: NextRequest) {
  const context = await adminApi(request);
  if (context instanceof NextResponse) return context;
  const { data, error } = await context.admin
    .from("job_offer_settings")
    .select("first_wave_size,second_wave_after_minutes,version")
    .eq("id", true)
    .single();
  if (error)
    return NextResponse.json(
      { error: "Job-offer settings could not be loaded." },
      { status: 503 },
    );
  return NextResponse.json(present(data), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const context = await adminApi(request);
  if (context instanceof NextResponse) return context;
  try {
    const settings = parseJobOfferSettings(await request.json());
    const { data, error } = await context.admin
      .from("job_offer_settings")
      .update({
        first_wave_size: settings.firstWaveSize,
        second_wave_after_minutes: settings.secondWaveAfterMinutes,
        version: settings.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: context.user.id,
      })
      .eq("id", true)
      .eq("version", settings.version)
      .select("first_wave_size,second_wave_after_minutes,version")
      .maybeSingle();
    if (error) throw new Error("Job-offer settings could not be saved.");
    if (!data)
      return NextResponse.json(
        {
          error:
            "Another administrator changed these settings. Reload before saving.",
        },
        { status: 409 },
      );
    return NextResponse.json(present(data));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid settings." },
      { status: 400 },
    );
  }
}
