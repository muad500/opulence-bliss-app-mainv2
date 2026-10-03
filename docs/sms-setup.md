# Booking SMS (disabled by default)

No SMS is sent unless BOOKING_SMS_ENABLED is exactly `true`, valid Twilio
credentials and a Messaging Service are present, and both budget values below
are positive. Production must remain disabled until the client supplies an SMS
account and approves its budget. Marketing messages are not sent by this system.

Required server environment values:

- BOOKING_SMS_ENABLED=false (default when absent)
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN (private)
- TWILIO_MESSAGING_SERVICE_SID
- TWILIO_MONTHLY_BUDGET_GBP
- TWILIO_MAX_COST_PER_MESSAGE_GBP

Set the per-message cap to a conservative upper bound for a single UK SMS,
including carrier fees and tax. The application reserves that amount under a
monthly database lock before each submission, and stops when reservations
reach the budget. Configure Twilio's own spend monitoring/limits too: the
application cannot control charges from other applications or an incorrect
cost cap. Values are server-only; never put credentials in public variables.

The existing minute-by-minute booking notifications scheduler also processes
SMS. Customers must explicitly choose SMS contact; reminders also respect their
booking-reminder preference. Booking received/confirmed, 24-hour and 90-minute
events use separate durable records. Cancellation/rescheduling expires the old
notices. No late reminders are sent after their deadline. Concurrent claims are
locked, and an ambiguous network outcome is held for manual reconciliation
rather than retried and possibly charged twice. An accepted Twilio message SID
means submitted, not proof of delivery. Failed submissions retain their budget
reservation conservatively.

Before enabling, use Twilio test credentials and a controlled test destination
to validate the real account, delivery and pricing. Current automated tests use
a mocked Twilio response; no real SMS is sent.

REST reference: https://www.twilio.com/docs/messaging/api/message-resource
