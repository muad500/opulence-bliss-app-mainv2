# Development tools

Demo login buttons are removed from client and professional sign-in. Admins
sign in at `/staff/login`; all admin pages require an active administrator role.

Reset tools, prototype finding cleanup and forced worker check-in default to
disabled. To use them on an isolated Preview, all of these must be present:

- `VERCEL_ENV=preview` (set by Vercel).
- `DEVELOPMENT_TOOLS_ENABLED=true`.
- `STRIPE_SECRET_KEY` must be a Stripe test secret.

Local development instead requires `NODE_ENV=development` with no `VERCEL_ENV`,
plus the same opt-in and test credential. Early check-in also requires
`ALLOW_EARLY_CHECKIN=true`. The customer's check-in OTP is always required.

Never enable these tools against the production database. Vercel Production
blocks them regardless of its Stripe key or opt-in flag. Normal resolution
desk actions remain available to authorised administrators.

Prototype reset dates only narrow reconciliation in an enabled development
environment. Production uses the configured reconciliation boundary. Cleanup
will never close a live Stripe transfer as historical test activity.

No migration or account deletion is part of this cleanup. The existing reset
RPC grants execution only to `service_role`, not `anon` or `authenticated`.
