"use client";
import { useActionState } from "react";
import { recordWelfareStep } from "./actions";
export default function StepForm({
  booking,
  scheduled,
}: {
  booking: string;
  scheduled: string;
}) {
  const [state, action, pending] = useActionState(recordWelfareStep, {
    message: "",
  });
  return (
    <form action={action} style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name="booking" value={booking} />
      <input type="hidden" name="scheduled" value={scheduled} />
      <label>
        Action actually taken
        <select name="action">
          <option value="cleaner_contacted">
            Phoned and messaged the cleaner
          </option>
          <option value="emergency_contacted">
            Phoned the emergency contact
          </option>
          <option value="police_welfare_requested">
            Requested a police welfare check
          </option>
          <option value="resolved">Confirmed safe / resolved</option>
        </select>
      </label>
      <label>
        What happened? Record facts, the response and next action
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button disabled={pending}>Log completed action</button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
