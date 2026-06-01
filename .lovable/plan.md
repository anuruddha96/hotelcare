## Goal

When attendance sign-in is blocked because location is unavailable (opt-out or browser permission denied), show a clear inline action that opens **Settings → Account → Location access** directly, focused and scrolled into view — no manual navigation needed.

## Changes

### 1. Global "open settings" event

Use a lightweight `window` CustomEvent so any component can request the Settings dialog without prop drilling.

- Event name: `hc:open-settings`
- Payload: `{ tab?: 'account' | 'notifications' | 'security'; focus?: 'location' }`

### 2. `Header.tsx`

- Add a `useEffect` that listens for `hc:open-settings`. On fire:
  - `setSettingsDialogOpen(true)`
  - Store `initialTab` and `focusTarget` in local state and pass them as new props to `SettingsDialog`.
- Reset those props when the dialog closes so a normal click on "Settings" behaves as before.

### 3. `SettingsDialog.tsx`

- Accept optional `initialTab?: string` and `focusTarget?: 'location'` props.
- Use `initialTab` as the `Tabs` `value` (controlled) when provided, defaulting to `'account'`.
- Give `LocationAccessCard` a stable `id="settings-location-access"` and a `ref`. When the dialog opens with `focusTarget === 'location'`:
  - `scrollIntoView({ block: 'center' })`
  - Add a temporary highlight (e.g. `ring-2 ring-primary` for ~2s) so the user immediately sees where to act.

### 4. `AttendanceTracker.tsx` — actionable denied state

- After `getCurrentLocation()` completes without a fix, call `getBrowserPermissionState()` to distinguish:
  - `granted` but opt-out → "Enable to sign in" path
  - `denied` → browser blocked
  - `prompt` / `unsupported` → not opted in yet
- Replace the silent "Getting your location…" line (around line 493) when there is no fix AND the call already finished, with a compact inline alert:
  - Icon + short message ("Location is required to sign in" / "Location access is blocked in your browser")
  - Primary button **"Open Location Settings"** that dispatches `hc:open-settings` with `{ tab: 'account', focus: 'location' }`
  - For `denied`, add secondary helper text linking to the browser-settings hint already present in `LocationAccessCard`.
- Also surface the same button next to the disabled **Sign In** button (around line 704–712) so users don't have to scroll to find it.

### 5. No changes to `locationPreference.ts`

It already exposes `getBrowserPermissionState`, `getOptIn`, `requestLocationOnce`, and `clearLocation` — reused as-is.

## Out of scope

- No DB / RLS changes.
- No changes to the sign-in business rules (still blocked without a fix; we just make the recovery one click).
- No new translation keys beyond two short strings (added to `useTranslation.tsx` EN + HU).

## Files touched

- `src/components/dashboard/AttendanceTracker.tsx`
- `src/components/dashboard/SettingsDialog.tsx`
- `src/components/layout/Header.tsx`
- `src/hooks/useTranslation.tsx` (two strings)
