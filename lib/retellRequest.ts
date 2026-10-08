import { Retell } from "retell-sdk";
import { VoiceBookingError } from "./voiceBooking";

export async function verifiedRetellRequest(raw: string, signature: string | null, apiKey?: string, allowedAgentId?: string) {
  if (!apiKey || !allowedAgentId) throw new VoiceBookingError("Voice booking is not configured yet.", 503);
  if (Buffer.byteLength(raw) > 128_000) throw new VoiceBookingError("Request is too large.", 413);
  if (!signature || !(await Retell.verify(raw, apiKey, signature))) throw new VoiceBookingError("Invalid Retell signature.", 401);
  let body: { name?: unknown; call?: { call_id?: unknown; agent_id?: unknown }; args?: unknown };
  try { body = JSON.parse(raw); } catch { throw new VoiceBookingError("Invalid JSON."); }
  if (!body || body.call?.agent_id !== allowedAgentId || typeof body.call?.call_id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(body.call.call_id)) {
    throw new VoiceBookingError("This call is not authorised for voice booking.", 403);
  }
  if (typeof body.name !== "string" || !body.args || typeof body.args !== "object" || Array.isArray(body.args)) throw new VoiceBookingError("Use Retell's name, call and args request format. Turn Payload args only off.");
  return { name: body.name, args: body.args as Record<string, unknown>, agentId: allowedAgentId, callId: body.call.call_id };
}
