## Push room clean-status to Previo for Hotel Ottofiori

Previo confirmed the account can now update room clean-status via `PUT /rest/rooms/{roomId}/clean-statuses`. Our current outbound push is close but has three concrete issues stopping it from working for Ottofiori.

### What's wrong today

1. **Wrong endpoint path.** `previo-update-room-status/index.ts` calls `/rest/rooms/{id}/clean-status` (singular). Previo's documented endpoint is `/rest/rooms/{id}/clean-statuses` (plural — the exact URL Gergő sent).
2. **Ottofiori is hard-blocked.** In `pms_configurations` for `hotel_id = 'ottofiori'`, `outbound_kill_switch = true`, so `previo-update-room-status` bails out with "Outbound push disabled for this hotel" before it ever hits Previo. Only `previo-test` is currently allowed to push.
3. **Body shape / status vocabulary are guesses.** We send `{ status: "clean" | "dirty" | ... }`. Previo's docs page for the endpoint isn't quoted in the email, so we don't know for certain whether it expects `status`, `cleanStatus`, `isClean`, numeric codes, etc. `previo-clean-status-probe` was written for exactly this — but it currently probes only the singular path.

### The fix

**A. Correct the endpoint path (both prod push and probe)**

- `supabase/functions/previo-update-room-status/index.ts`: change the PUT path from `/rest/rooms/${previoRoomId}/clean-status` → `/rest/rooms/${previoRoomId}/clean-statuses`.
- `supabase/functions/previo-clean-status-probe/index.ts`: add the plural path to the candidate list (keep the singular one for backwards comparison), so the next probe run covers what Previo actually documents.

**B. Enable outbound push for Ottofiori (test-environment only)**

Run a one-line data update so the manager can validate end-to-end without touching every hotel:

```sql
UPDATE public.pms_configurations
   SET outbound_kill_switch = false
 WHERE hotel_id = 'ottofiori' AND pms_type = 'previo';
```

`status_push_enabled` is already `true`, `outbound_room_allowlist` is null → all mapped rooms become eligible once the kill-switch is off.

**C. Verify the body/status vocabulary with the probe before trusting the push**

After deploying (A), call `previo-clean-status-probe` for Ottofiori against one real mapped room:

```
POST /previo-clean-status-probe
{ "hotelId": "ottofiori", "targetStatus": "clean" }
```

Read the `successes[]` array in the response. The first 2xx entry tells us exactly which `path + method + body` combination Previo accepts. If it's not `PUT /rest/rooms/{id}/clean-statuses` with `{ status: "clean" }`, patch `previo-update-room-status` to match (endpoint, body key, and the value returned by `mapToPrevioStatus`) and redeploy. If every candidate returns 4xx/5xx, capture the response snippet and email Gergő with the exact payload we're sending — we've done everything on our side.

**D. Smoke-test the real push path**

Once (C) confirms the accepted shape, invoke `previo-update-room-status` directly for one Ottofiori room and check:

- 200 response with `success: true`.
- A new row in `pms_sync_history` with `sync_type='room_status_update'`, `direction='push'`, `sync_status='success'`.
- Previo dashboard reflects the room switching from dirty → clean.

### Out of scope for this pass

- No changes to the outbound queue worker, retry/backoff logic, or trigger gating.
- No enabling of push for hotels other than Ottofiori. Every other hotel keeps its current `outbound_kill_switch` value.
- No changes to inbound sync (`previo-pull-revenue`, `previo-pms-sync`, etc.) — those are already working per the manager's confirmation.
- No live-app modifications while housekeepers are working; the SQL update only flips a config flag and does not touch assignments or room statuses.