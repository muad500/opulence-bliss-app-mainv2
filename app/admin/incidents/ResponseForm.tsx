"use client";
import { useActionState } from "react";
import { sendComplaintResponse } from "./actions";
export default function ResponseForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(sendComplaintResponse, {
    ok: false,
    message: "",
  });
  return (
    <details>
      <summary>Reply using the Complaints Procedure template</summary>
      <form action={action} style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <input type="hidden" name="id" value={id} />
        <label>
          Email type
          <select name="kind">
            <option value="ack">
              Acknowledgement (check no acknowledgement was already sent outside
              the website)
            </option>
            <option value="reply">Full reply</option>
            <option value="complex">Needs more time — complex case</option>
          </select>
        </label>
        <label>
          What we checked
          <textarea name="checked" maxLength={2000} />
        </label>
        <label>
          What we found
          <textarea name="findings" maxLength={2000} />
        </label>
        <label>
          What we will do
          <textarea name="action" maxLength={2000} />
        </label>
        <label>
          For a complex-case update: why more time is needed
          <textarea name="reason" maxLength={2000} />
        </label>
        <p>
          The customer receives the policy&apos;s reply template with these
          details. A complex-case update keeps the day-28 deadline; data
          complaints keep day 30. Review the facts before sending.
        </p>
        <button disabled={pending}>Queue customer email</button>
        {state.message && <p role="status">{state.message}</p>}
      </form>
    </details>
  );
}
