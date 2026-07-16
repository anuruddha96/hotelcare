## What I found

There are two separate issues.

### PMS sync root cause
The saved Previo credential is working for the room-list endpoint:

`/rest/rooms` succeeds for Ottofiori.

The failure is only on the reservation/departure endpoint:

`searchReservations` returns `401 Invalid login or password`.

So this is probably not “the password is wrong”. The app is currently using the same saved credential in two different ways:

- Room list sync tries the saved value as a Previo API key and succeeds.
- Reservation/departure sync sends it through the XML login/password flow and Previo rejects it.

That means the auth handling is inconsistent, not necessarily that the hotel credential changed.

### Team View issue
Managers land on the main **Housekeeping** section, but `HousekeepingTab` briefly starts on `assignments` and only later decides which manager tab to show. On mobile this can leave the tab strip visible but no Team View content selected until the manager taps it.

## Plan

1. **Fix Previo reservation/departure auth properly**
   - Update the shared Previo XML credential helper so REST-style saved credentials that work as an API key are also tried as an XML/API-key auth variant for `searchReservations`.
   - Keep existing XML login/password support for tenants that really use XML credentials.
   - Do not mark the whole PMS password as wrong when only the reservation feed rejects one auth method.

2. **Make PMS sync truly validate both feeds**
   - Update the Previo connection test to test:
     - Room list feed: `/rest/rooms`
     - Reservation/departure feed: `searchReservations`
   - Store a clear result in PMS configuration/history so admins can see whether room status and checkout/departure data are both working.

3. **Improve PMS sync behavior after the auth fix**
   - Run `previo-pms-sync` using the corrected auth handling.
   - Confirm it reports real reservation availability instead of `0 depart today / 0 depart tomorrow` caused by reservation auth failure.
   - Keep the safety guard: if Previo truly provides no reservation data, checkout rooms are preserved rather than incorrectly moved to Daily Rooms.

4. **Fix manager Team View default**
   - Initialize `HousekeepingTab` directly to the manager default tab instead of `assignments`.
   - For managers/admin/housekeeping managers, default to:
     - `supervisor` if pending approvals exist
     - otherwise `manage` / Team View
   - Ensure the parent breadcrumb state is also updated immediately so the UI and content match.

5. **Verify**
   - Deploy the affected Previo edge functions.
   - Check edge logs for `searchReservations` success/failure after the fix.
   - Confirm managers opening the app see Housekeeping with Team View content selected automatically.