## Problem

Two issues combine to give breakfast_staff a blank page:

1. **`/bb/auth` does not exist.** `PublicBreakfastApp` (the provider tree mounted whenever `window.location.pathname` starts with `/bb`) only registers routes `/bb` and `/bb/:hotelCode`. Any other `/bb/*` URL renders nothing — hence the blank screen the user sees at `/bb/auth`.
2. **Client-side `<Navigate to="/bb">` keeps the user inside `MainApp`.** When `Index.tsx` routes a `breakfast_staff` user with `<Navigate to="/bb" replace />`, React Router stays mounted in `MainApp`, which has no `/bb` route → falls through to `NotFound` (blank-ish). The `window.location.pathname` check in `App.tsx` only runs on initial load, not on client navigations, so `PublicBreakfastApp` never takes over.

We also want breakfast_staff users to be confined to `/bb` and to never trigger the manager `RealtimeNotificationProvider`.

## Fix

### 1. `src/pages/Index.tsx` — hard-redirect breakfast_staff
Replace the `<Navigate to="/bb" replace />` for `profile?.role === 'breakfast_staff'` with a full reload:

```ts
useEffect(() => {
  if (profile?.role === 'breakfast_staff' && window.location.pathname !== '/bb') {
    window.location.replace('/bb');
  }
}, [profile?.role]);
```
Render the loading spinner while redirecting. This guarantees `PublicBreakfastApp` mounts on the next load, so no manager notifications subscribe.

### 2. `src/pages/Auth.tsx` — same hard-redirect after login
After a successful `signIn`, before the `<Navigate>` for `user`, check the freshly-loaded profile role. If `breakfast_staff` → `window.location.replace('/bb')`. (Use a small `useEffect` watching `user` + `profile.role` rather than the inline `<Navigate>` for that role.)

### 3. `src/App.tsx` — add `/bb/auth` to `PublicBreakfastApp`
Add a new lightweight component `BreakfastAuth` (new file `src/pages/BreakfastAuth.tsx`) and register:

```tsx
<Route path="/bb/auth" element={<BreakfastAuth />} />
```

`BreakfastAuth` is a self-contained sign-in page (does NOT use `useAuth` / `AuthProvider`):
- Email + password form.
- Calls `supabase.auth.signInWithPassword(...)`.
- After success, fetches the user's `profiles` row to read `role`.
  - If role === `breakfast_staff` → `window.location.replace('/bb')`.
  - Otherwise → call `supabase.auth.signOut()` and show "This login is for breakfast staff only. Please use the main app."
- Reuses HotelCare branding (logo + same gradient card) for visual consistency.

### 4. `src/pages/Breakfast.tsx` — gate access for logged-in non-staff & offer login for staff
At the top of `Breakfast`, check `supabase.auth.getSession()` once on mount:
- If a session exists AND profile role is `breakfast_staff` → continue normally (and show a small "Sign out" button in the header that calls `supabase.auth.signOut()` then `window.location.replace('/bb/auth')`).
- If a session exists with any other role → ignore it (page stays public; do NOT log them out — managers may legitimately open `/bb` to test).
- If no session → page stays fully public as today.

Add a small "Staff sign-in" link in the footer of the hotel-picker view that points to `/bb/auth`, so breakfast staff have an obvious way in.

### 5. Confine breakfast_staff inside `MainApp` routes
In `useAuth` (or a small guard inside `TenantRouter`), if `profile?.role === 'breakfast_staff'` and the current path is not `/bb*`, perform `window.location.replace('/bb')`. This handles the case where a staff user manually types a manager URL.

## Files touched
- `src/pages/Index.tsx` — replace `<Navigate>` with `window.location.replace`.
- `src/pages/Auth.tsx` — post-login role check, hard redirect for breakfast_staff.
- `src/App.tsx` — register `/bb/auth` route in `PublicBreakfastApp`.
- `src/pages/BreakfastAuth.tsx` — new self-contained sign-in page.
- `src/pages/Breakfast.tsx` — optional sign-out button + "Staff sign-in" link, no functional change for public users.
- `src/hooks/useAuth.tsx` (or `TenantRouter`) — guard non-/bb routes for breakfast_staff.

No DB changes needed.
