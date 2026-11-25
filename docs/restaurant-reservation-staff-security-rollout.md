# Restaurant reservation privacy and staff security: rollout

**GitHub merge is not a production database or Edge Function deployment.**

## Release order

1. Apply supabase/migrations/20261122083500_restaurant_reservation_staff_security.sql in an approved migration release before deploying modified restaurant Edge Functions. Verify the new status_marked_user_id column, audit trigger, and restricted guest-data SELECT policy.
2. Deploy restaurant-reservations-list, restaurant-reservation-status, restaurant-reservation-seen, restaurant-reservation-create, restaurant-reservations-sync, then the updated /bb frontend.
3. Keep the independent HMAC-signed restaurant booking webhook; do not enable unauthenticated guest-list or status endpoints.

## Physical shared-tablet acceptance

- Signed out: public breakfast room lookup/recipes still work, while Reservations only shows staff sign-in and no guest data.
- Signed in with individual breakfast staff/reception: only assigned hotels and explicit same-organization duty scopes load bookings; switching hotel picker alone does not grant access.
- Changes to Arrived and No-show require appropriate confirmation, record a verified staff actor, survive reload, and sync to the Sales Dashboard. Forged marked_by must be ignored.
- On two devices, stale status updates are rejected; first-seen is idempotent. Cancelled/completed bookings cannot be reopened via these controls.
- On sign-out or expired session, guest data disappears and protected endpoints reject requests. Test cross-tenant and unauthorized roles.
- Browser lock-screen notifications must not show guest names. Manual reservation creation and new-booking alerts still work.

## Monitoring/rollback

Monitor guest-data 401/403 rates and restaurant feed sync issues after the authorized rollout. If necessary, revert Edge/frontend versions, but do NOT reintroduce publicly readable guest reservations. The additive audit schema may remain.

Automated auth, shared-device component, Edge type, and PostgreSQL integration tests run in CI. Physical tablet tests still require the eventual authorized rollout.