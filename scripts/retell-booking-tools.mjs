export function bookingTools(origin, { vercelProtectionBypass } = {}) {
  if (vercelProtectionBypass && !new URL(origin).hostname.endsWith(".vercel.app")) {
    throw new Error("A Vercel protection secret can only be sent to a vercel.app deployment.");
  }
  const text = (description, extra = {}) => ({ type: "string", description, ...extra });
  const number = (description, extra = {}) => ({ type: "integer", description, ...extra });
  const common = {
    service_id: text("Exact service ID returned by get_cleaning_services. Never invent an ID."),
    postcode: text("Caller's confirmed full UK service postcode, for example SW3 1AA."),
    duration_minutes: number("Confirmed duration in minutes; 2 hours is 120. Half-hour steps from 120 to 480.", { minimum: 120, maximum: 480, multipleOf: 30 }),
    frequency: text("Confirmed frequency. Essential Clean requires regular visits; one-off services require one_time.", { enum: ["one_time", "weekly", "fortnightly", "monthly"] }),
    visits: number("1 for one_time. For regular cleaning confirm between 6 and 10 visits paid upfront.", { minimum: 1, maximum: 10 }),
  };
  const tool = (name, description, properties, required = Object.keys(properties)) => ({
    type: "custom", name, description, url: `${origin}/api/retell/booking`, method: "POST",
    parameter_type: "json", args_at_root: false, timeout_ms: 30_000, max_retry: 1,
    speak_during_execution: false, speak_after_execution: true, enable_typing_sound: false,
    ...(vercelProtectionBypass ? { headers: { "x-vercel-protection-bypass": vercelProtectionBypass } } : {}),
    parameters: { type: "object", properties, required, additionalProperties: false },
  });
  return [
    tool("get_cleaning_services", "Get current cleaning services, rates and the server's current time. Call before quoting prices or choosing a service for a booking.", {}),
    tool("check_booking_options", "Check postcode coverage and permitted booking times for a specific London date, and calculate the current total. This does not reserve a slot or guarantee a cleaner.", {
      ...common, date: text("Requested calendar date in London, YYYY-MM-DD. Confirm ambiguous dates."),
      preferred_time: text("Optional earliest preferred London time, HH:mm, for example 14:00. Omit for all times that day."),
    }, [...Object.keys(common), "date"]),
    { ...tool("create_voice_booking", "Save the confirmed cleaning booking request and email its secure review/payment link. Call only after reading back service, address, home, time, duration, frequency, visit count, price and contact details and receiving agreement. This does not charge a card or confirm a paid booking.", {
      ...common,
      customer_name: text("Customer's confirmed full name."), email: text("Confirmed email for the payment link; spell it back. Customer must sign in with this email."),
      phone: text("Confirmed UK contact number for the cleaner. Accept +44, local 07... or ten digits; do not substitute an Indian test number."),
      address: text("Full street address, flat/house number and town, confirmed with caller."),
      property_type: text("Confirmed property type.", { enum: ["studio", "flat", "house", "other"] }),
      bedrooms: number("Bedroom count, from 0 to 8; studio has 0.", { minimum: 0, maximum: 8 }),
      bathrooms: number("Bathroom count from 1 to 8.", { minimum: 1, maximum: 8 }),
      slot: text("Exact ISO timestamp from check_booking_options.slots[].slot. Do not calculate timezone offsets yourself."),
      request: text("Optional special cleaning requests, maximum 250 characters.", { maxLength: 250 }),
      confirmed: { type: "boolean", description: "True only after the caller agreed to the full read-back and price. Never assume consent." },
    }, [...Object.keys(common), "customer_name", "email", "phone", "address", "property_type", "bedrooms", "bathrooms", "slot", "confirmed"]), response_variables: { voice_booking_request_id: "request_id" } },
    tool("get_voice_booking_status", "Check whether this call's request has resulted in saved paid/authorised bookings. Use the request_id returned by create_voice_booking. Never confirm until status is confirmed.", { request_id: text("Request ID returned by create_voice_booking for this same call.") }),
  ];
}
