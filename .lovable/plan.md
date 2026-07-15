## Fix: only 305 should not be RTC

PMS export confirms:
- **10 checkouts today**: 102, 104, 201, 203, 303, **305**, 401, 403, 404, 405
- **301 = Occupied (daily)** — leave as-is, do not touch
- **305** = scheduled checkout but guest hasn't left Previo yet → must stay non-RTC on `pms_hold`
- **All other 9 checkouts** = RTC (401 now confirmed by Previo)

### Data corrections (insert tool only — no schema, no code changes)

1. **Room 305 (Ottofiori, today)**
   - `rooms`: `is_checkout_room=true`, `checkedOutToday=false`, `pms_hold=true`, `checkout_time=null`.
   - `room_assignments` (today, 305): keep `assignment_type='checkout_cleaning'`, force `status` back from `ready_to_clean` to its pre-RTC state (`pending`/`assigned`), set hold flag consistent with other held rooms.
   - Remove any stale `checkout_confirmed` / `manager_verified_previo` event for 305 today so the cron will fire cleanly when Previo confirms.

2. **Room 401 (Ottofiori, today)** — Previo now confirms departure
   - `rooms`: clear `pms_hold`, ensure `is_checkout_room=true`, `checkedOutToday=true`, `checkout_time=now()` if empty.
   - `room_assignments`: `status='ready_to_clean'`.

3. **Room 301** — no changes. Verify it's `daily_cleaning`, `is_checkout_room=false`, no hold. If a prior correction wrongly flipped it, revert to daily/occupied.

### Cron behavior (no code change needed)

The existing `previo-poll-checkouts` self-heal already:
- Clears `pms_hold` and sets `ready_to_clean` when Previo reports the guest as departed.
So once the 305 guest actually checks out in Previo, the next 5-minute poll will flip 305 to RTC automatically. No code patch required.

### Verification

- Query Ottofiori assignments for today → expect 10 checkout rows, 9 RTC, 305 held/non-RTC, 301 untouched as daily.
- Trigger `previo-poll-checkouts` once and re-query to confirm nothing regresses.
