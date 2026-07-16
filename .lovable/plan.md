## What I found

The warning in your screenshot is coming from the automatic/manual Previo refresh path. The room list sync succeeds, but the reservation/departure lookup fails with:

`XML API 401: Invalid login or password`

Because departure data is missing, the app protects existing checkout buckets and shows **PMS sync partial** instead of risking moving checkout rooms into Daily Rooms incorrectly.

## Plan

1. **Make the sync message manager-friendly**
   - Replace the long technical toast text with a short message like:
     - **“Previo room list synced, but checkout/departure data was unavailable. Please verify checkout rooms manually.”**
   - Keep technical details only in logs/admin sync history.

2. **Stop showing this as a generic row error**
   - Treat missing reservation/departure data as a specific PMS auth/data issue, not “rooms failed”.
   - Continue syncing room clean status where safe.
   - Keep checkout/daily grouping protected when departure data is unavailable.

3. **Improve Previo XML credential handling**
   - Update the Previo reservation call to use the same successful auth variant detected by the connection test when available, instead of retrying blindly each morning.
   - If Previo still returns 401, record a clear admin-facing error that the reservation/departure API credentials need updating.

4. **Add better admin diagnostics**
   - In PMS sync status/history, show that the room catalog succeeded but reservation/departure feed failed.
   - Include the exact non-secret reason: **“Previo rejected reservation/departure API login.”**

5. **Verify after implementation**
   - Run the Previo sync function for the affected hotel.
   - Confirm the manager sees the short warning and that checkout rooms are preserved safely.
   - Check edge logs/history for the clean diagnostic message.