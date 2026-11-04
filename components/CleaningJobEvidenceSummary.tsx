import { createClient } from "@/lib/supabase/server";
export default async function CleaningJobEvidenceSummary({
  bookingId,
  staff = false,
}: {
  bookingId: string;
  staff?: boolean;
}) {
  const client = await createClient();
  const result = await client
    .from("cleaning_job_evidence")
    .select(
      "tasks,completed_tasks,hazard_note,scope_confirmed_at,finished_at,photo_note",
    )
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const photos = await client
    .from("cleaning_job_photos")
    .select("id,stage")
    .eq("booking_id", bookingId)
    .order("created_at");
  const e = result.data;
  return (
    <details
      style={{
        background: "white",
        border: "1px solid #e4dced",
        borderRadius: 16,
        padding: 20,
        margin: "20px 0",
      }}
    >
      <summary>
        <strong>Work checklist and photos</strong>
      </summary>
      <p>
        {e.finished_at
          ? `Completed ${new Date(e.finished_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}`
          : "The cleaner will record the work here during the visit."}
      </p>
      {e.hazard_note && <p>Pre-existing damage or hazards: {e.hazard_note}</p>}
      {e.finished_at && (
        <ul>
          {(e.tasks as string[]).map((task, index) => (
            <li key={index}>
              {task} —{" "}
              {e.completed_tasks[index]?.result === "done"
                ? "Done"
                : `Not applicable / not completed: ${e.completed_tasks[index]?.reason ?? "See visit notes"}`}
            </li>
          ))}
        </ul>
      )}
      {e.photo_note && <p>Photos: {e.photo_note}</p>}
      {(photos.data ?? []).map((photo, index) => (
        <p key={photo.id}>
          <a
            target="_blank"
            rel="noreferrer"
            href={`${staff ? "/api/admin/work-evidence" : "/api/account/work-evidence"}/${bookingId}/photos/${photo.id}`}
          >
            {photo.stage === "before" ? "Before-work" : "Finished-work"} photo{" "}
            {index + 1}
          </a>
        </p>
      ))}
    </details>
  );
}
