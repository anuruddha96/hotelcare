## Two bugs to fix

### Bug 1: Pending Approvals count leaks across hotels for admins

**Where**: `src/hooks/usePendingApprovals.tsx`

The hook currently filters by `organization_slug` only, then short-circuits the hotel filter for `admin` and `top_management` roles (lines 62 and 84). That's why an admin logged into Gozsdu Court sees 8 approvals — they actually belong to Ottofiori (the only live hotel in the org).

**Fix**: Always filter by the currently active hotel (`profile.assigned_hotel`) regardless of role. Admins switch hotels via the existing `HotelSwitcher` (which writes `assigned_hotel`), so the active hotel is always known. If `assigned_hotel` is null, return 0 instead of org-wide totals.

```ts
// Replace the role-gated branch with unconditional hotel scoping
if (!userHotel) { setPendingCount(0); setMaintenanceTicketCount(0); return; }
query = query.or(`hotel.eq.${userHotel}${resolvedHotelName && resolvedHotelName !== userHotel ? `,hotel.eq.${resolvedHotelName}` : ''}`, { referencedTable: 'rooms' });
ticketQuery = ticketQuery.or(`hotel.eq.${userHotel}${resolvedHotelName && resolvedHotelName !== userHotel ? `,hotel.eq.${resolvedHotelName}` : ''}`);
```

**Audit pass**: grep other dashboards/badges that use the same `['admin','top_management'].includes(role)` shortcut to bypass hotel filtering and confirm they don't show cross-hotel counts on a per-hotel page. Files to inspect:
- `src/components/dashboard/HousekeepingTab.tsx`
- `src/components/dashboard/RoomManagement.tsx`
- `src/components/dashboard/RoomAssignmentSummary.tsx`
- `src/components/dashboard/AttendanceManagement.tsx`
- `src/components/dashboard/AttendanceReports.tsx`
- `src/components/dashboard/Dashboard.tsx`
- `src/components/dashboard/HousekeepingStaffManagement.tsx`

For each, scope to `assigned_hotel` when displayed inside a hotel-specific page (Operations / Tickets / Housekeeping / Attendance tabs). The Revenue index page (`src/pages/Revenue.tsx`) is the only place that legitimately shows all hotels in the org — leave it alone.

### Bug 2: Revenue XLSX upload fails with "Edge Function returned a non-2xx status code"

**Where**: `supabase/functions/revenue-pickup-upload/index.ts`

Edge function logs show:
```
ERROR revenue-pickup-upload error: Error: Unauthorized
   at index.ts:174:31
```

Line 174 is the `if (!userRes?.user) throw new Error("Unauthorized")` check. The function instantiates the Supabase client with the **service role key** plus the user's `Authorization` header. With `verify_jwt = true` (already set in `config.toml`), the gateway has already validated the JWT — but `supabase.auth.getUser()` called on a service-role client doesn't reliably resolve the bearer token to a user.

**Fix**: Validate the user with an anon-key client (or call `auth.getUser(token)` with the explicit JWT), then use the service-role client for DB inserts.

```ts
const token = authHeader.replace('Bearer ', '');
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { data: userRes, error: uErr } = await anon.auth.getUser(token);
if (uErr || !userRes?.user) throw new Error("Unauthorized");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY); // for DB writes
```

Apply the same pattern to other revenue edge functions if they share the bug: `revenue-export`, `revenue-ai-analyze`, `revenue-engine-tick`.

### Verification

1. Log in as admin to Gozsdu (no live data) → Pending Approvals badge shows 0; switching to Ottofiori shows the 8.
2. Upload a Previo pickup XLSX from the Revenue page → returns 200 with `{rows, hotel_id}`; row appears under the matching hotel card.
3. Smoke-test housekeeping flows on Ottofiori (assignments, completion, approval) — counts must remain unchanged.
