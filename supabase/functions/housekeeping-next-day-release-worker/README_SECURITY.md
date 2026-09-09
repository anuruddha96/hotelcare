# Next-day housekeeping release worker security

This Edge Function is invoked by the database scheduler only.

Security invariants:
- `verify_jwt = false` is intentional because pg_cron/pg_net calls the worker outside a user session.
- Every invocation must provide the Vault-backed `x-worker-secret` and the worker compares it before claiming any plan.
- Production scheduling uses POST only. The worker should reject non-POST methods other than CORS OPTIONS.
- The service-role key stays server-side and is never returned to the browser.
- A plan is released only after fresh server-side Previo revalidation and the database release RPC is service-role-only.
