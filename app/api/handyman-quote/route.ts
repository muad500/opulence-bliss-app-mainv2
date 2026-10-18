import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isValidUkPhone, normalizeUkPhone } from "@/lib/ukPhone";
import { isSameOriginMutation, readAccountBody } from "@/lib/accountApi";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { boundedFormData } from "@/lib/boundedForm";
import {
  QUOTE_MULTIPART_MAX_BYTES,
  QUOTE_PHOTO_MAX_BYTES,
  QUOTE_PHOTO_MAX_COUNT,
  QUOTE_PHOTO_BUCKET,
  quotePhotoKind,
} from "@/lib/quotePhotos";

const admin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TASK_TYPES = new Set([
  "Mounting and hanging",
  "Furniture assembly",
  "Minor repairs",
  "Curtains and blinds",
  "Furniture moving",
  "Minor decorating",
  "Other",
]);

function text(value: unknown, max: number) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginMutation(request))
      return NextResponse.json(
        { error: "Use the website to request a quote." },
        { status: 403 },
      );
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in with a customer account before requesting a quote." },
        { status: 401 },
      );
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.role === "admin") {
      return NextResponse.json(
        {
          error:
            "A customer account is required to request a property maintenance quote.",
        },
        { status: 403 },
      );
    }

    const multipart = request.headers
      .get("content-type")
      ?.startsWith("multipart/form-data");
    let files: File[] = [];
    let body: Record<string, unknown>;
    try {
      if (multipart) {
        const form = await boundedFormData(request, QUOTE_MULTIPART_MAX_BYTES);
        body = Object.fromEntries(
          [...form.entries()].filter(([, value]) => typeof value === "string"),
        );
        body.consentAccepted = body.consentAccepted === "on";
        files = form
          .getAll("photos")
          .filter(
            (file): file is File => file instanceof File && file.size > 0,
          );
      } else {
        const json = await readAccountBody(request);
        if (json instanceof NextResponse) return json;
        body = json;
      }
    } catch {
      return NextResponse.json(
        { error: "Choose up to 3 photos, each no larger than 1 MB." },
        { status: 413 },
      );
    }
    if (
      files.length > QUOTE_PHOTO_MAX_COUNT ||
      files.some((file) => file.size > QUOTE_PHOTO_MAX_BYTES)
    )
      return NextResponse.json(
        { error: "Choose up to 3 photos, each no larger than 1 MB." },
        { status: 400 },
      );
    const quoteId = randomUUID();
    const photos: { path: string; name: string }[] = [];
    const decoded: Buffer[] = [];
    try {
      for (const file of files) {
        const bytes = Buffer.from(await file.arrayBuffer());
        if (!quotePhotoKind(bytes)) throw new Error("Unsupported photo");
        const photo = await sharp(bytes, {
          limitInputPixels: 16000000,
          animated: false,
        })
          .rotate()
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 80 })
          .toBuffer();
        if (photo.length > QUOTE_PHOTO_MAX_BYTES)
          throw new Error("Photo too large");
        decoded.push(photo);
      }
    } catch {
      return NextResponse.json(
        { error: "Use valid JPEG, PNG or WebP photos, each under 1 MB." },
        { status: 400 },
      );
    }
    const fullName = text(body.fullName, 120);
    const email = text(body.email, 180).toLowerCase();
    const phone = text(body.phone, 40);
    const address = text(body.address, 240);
    const postcode = text(body.postcode, 16).toUpperCase();
    const taskType = text(body.taskType, 100);
    const description = text(body.description, 2000);
    const preferredDate = text(body.preferredDate, 10) || null;
    const preferredTime = text(body.preferredTime, 80) || null;
    const consentAccepted = body.consentAccepted === true;

    if (
      !fullName ||
      !email ||
      !phone ||
      !address ||
      !postcode ||
      !taskType ||
      !description ||
      !consentAccepted
    ) {
      return NextResponse.json(
        { error: "Complete all required quotation fields." },
        { status: 400 },
      );
    }
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 },
      );
    }
    if (!isValidUkPhone(phone)) {
      return NextResponse.json(
        { error: "Enter a valid UK phone number." },
        { status: 400 },
      );
    }
    if (!TASK_TYPES.has(taskType)) {
      return NextResponse.json(
        { error: "Choose a valid property maintenance task." },
        { status: 400 },
      );
    }

    let preferredProviderId: string | null = null;
    if (body.preferredProviderId) {
      preferredProviderId = text(body.preferredProviderId, 36);
      if (!/^[0-9a-f-]{36}$/i.test(preferredProviderId))
        return NextResponse.json(
          { error: "Choose a valid professional." },
          { status: 400 },
        );
      const { data: eligible, error: eligibleError } = await supabase
        .rpc("public_eligible_provider_ids")
        .eq("id", preferredProviderId);
      if (eligibleError || !eligible?.length)
        return NextResponse.json(
          { error: "This professional is no longer available for quotes." },
          { status: 409 },
        );
      const { data: provider } = await admin
        .from("providers")
        .select("services, service_approvals")
        .eq("id", preferredProviderId)
        .maybeSingle();
      if (
        !provider?.services?.includes("handyman") ||
        provider.service_approvals?.handyman !== "approved"
      )
        return NextResponse.json(
          {
            error:
              "This professional cannot provide property maintenance quotes.",
          },
          { status: 400 },
        );
    }
    for (const [index, photo] of decoded.entries()) {
      const path = user.id + "/" + quoteId + "/" + randomUUID() + ".jpg";
      const { error } = await admin.storage
        .from(QUOTE_PHOTO_BUCKET)
        .upload(path, photo, { contentType: "image/jpeg", upsert: false });
      if (error) {
        if (photos.length)
          await admin.storage
            .from(QUOTE_PHOTO_BUCKET)
            .remove(photos.map((item) => item.path));
        return NextResponse.json(
          {
            error: "Your photos could not be saved. No request was submitted.",
          },
          { status: 503 },
        );
      }
      photos.push({ path, name: "Job photo " + (index + 1) });
    }
    const { data, error } = await admin
      .from("handyman_quote_requests")
      .insert({
        customer_id: user.id,
        id: quoteId,
        preferred_provider_id: preferredProviderId,
        photos,
        full_name: fullName,
        email,
        phone: normalizeUkPhone(phone),
        address,
        postcode,
        task_type: taskType,
        description,
        preferred_date: preferredDate,
        preferred_time: preferredTime,
      })
      .select("reference")
      .single();

    if (error) {
      if (photos.length)
        await admin.storage
          .from(QUOTE_PHOTO_BUCKET)
          .remove(photos.map((item) => item.path));
      throw error;
    }

    return NextResponse.json({ ok: true, reference: data.reference });
  } catch (caught) {
    const message =
      caught instanceof Error
        ? caught.message
        : "Could not send your quote request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
