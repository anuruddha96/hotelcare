# Smarter Location Access UX

Goal: only prompt for location when the user actually needs it (clicking Sign In), persist their choice, detect blocked/blacklisted browser permission, and guide them step-by-step to fix it — translated into all supported languages including Filipino (`tl`).

## 1. `src/lib/locationPreference.ts` — persistence + sync

- Add `syncOptInFromBrowser()`:
  - Reads `navigator.permissions.query({name:'geolocation'})`.
  - If browser state is `granted` and we have no opt-in flag yet, silently set opt-in `true` and refresh the cached fix (no prompt).
  - If browser state is `denied`, clear cached fix and mark `optIn=false` so UI shows the recovery path.
  - Subscribe to the `PermissionStatus.onchange` event and re-run sync; emit a `window` event `hc:location-permission-changed` with the new state so live components can react.
- Add `getPermissionStateCached()` helper that caches the last known state in memory (avoids re-querying every render).
- Call `syncOptInFromBrowser()` once on app boot (from `App.tsx` effect) and whenever the page regains visibility.

## 2. `AttendanceTracker.tsx` — prompt only on Sign In

- Remove the mount-time geolocation request. On mount only call `resolveLocationIfAllowed()` (cache-only path, never prompts).
- In `handleCheckIn`:
  1. If we already have a fresh `location`, proceed.
  2. Otherwise call `requestLocationOnce()` (this is the only place that triggers the native prompt).
  3. On success: continue check-in.
  4. On failure with permission `denied` / `unsupported`: open the new `BrowserLocationHelpDialog` (see §3) and abort check-in with a single toast.
- Sign Out / break / room-start flows must NOT prompt — they reuse the cached fix or proceed without one (location is only required for check-in per current rules).
- Replace inline English strings (`'This device does not support location.'`, etc.) with `t('attendance.location.*')` keys.

## 3. New `src/components/dashboard/BrowserLocationHelpDialog.tsx`

- Props: `open`, `onOpenChange`, `reason: 'denied' | 'blocked' | 'unsupported'`.
- Detects browser + OS from `navigator.userAgentData` (fallback to UA string): Chrome desktop, Edge, Safari macOS, Safari iOS, Firefox, Chrome Android, Samsung Internet.
- Renders an ordered, illustrated step list per browser (icons from lucide-react, no external screenshots). Example for Chrome desktop:
  1. Click the 🔒 lock icon in the address bar.
  2. Find "Location" and switch it to **Allow**.
  3. Reload the page.
- For Chrome/Edge desktop also show a "Copy settings URL" button (`chrome://settings/content/location`) since the page cannot navigate there directly.
- Footer buttons: **Open Settings → Location Access** (dispatches existing `hc:open-settings` event with `focus:'location'`), **I've fixed it — try again** (re-runs `requestLocationOnce()` then closes on success), **Close**.
- All copy keyed under `t('locationHelp.*')`.

## 4. `SettingsDialog.tsx` — recovery surface

- In the Location Access card, when `permState === 'denied'`:
  - Replace the generic "permission blocked" text with a CTA button **"How to unblock location"** that opens `BrowserLocationHelpDialog`.
  - Keep the toggle disabled until permission becomes `granted` (live-updated via the `hc:location-permission-changed` event from §1).
- When `permState === 'granted'` and opt-in is on, show "Enabled — using your browser's allowed location."
- Translate every visible string in this card via `t('settings.location.*')`.

## 5. Global recovery flow

- In `App.tsx` (or the existing root provider), listen for `hc:location-permission-changed`:
  - If new state is `denied` AND the user is on a route that requires location (currently only the attendance check-in moment), dispatch `hc:open-location-help` which `BrowserLocationHelpDialog` (mounted once at root) consumes.
- Add a thin root-level mount of `BrowserLocationHelpDialog` so any component can trigger it without prop-drilling.

## 6. Translations

Add new keys to **all** supported language bundles (`en, hu, es, vi, mn, az, tl`) in `src/lib/comprehensive-translations.ts` (or a new `location-translations.ts` for tidiness):

- `settings.location.title`, `settings.location.description`, `settings.location.enable`, `settings.location.disable`, `settings.location.enabled`, `settings.location.blockedTitle`, `settings.location.blockedHelpCta`, `settings.location.permissionGranted`
- `attendance.location.denied`, `attendance.location.unsupported`, `attendance.location.requestingPrompt`, `attendance.location.checkInRequires`
- `locationHelp.title`, `locationHelp.intro`, `locationHelp.chromeDesktop.step1..3`, `locationHelp.safariIos.step1..3`, `locationHelp.chromeAndroid.step1..3`, `locationHelp.firefox.step1..3`, `locationHelp.edge.step1..3`, `locationHelp.copyUrl`, `locationHelp.openSettings`, `locationHelp.tryAgain`, `locationHelp.close`, `locationHelp.fixed`, `locationHelp.stillBlocked`

Filipino translations included alongside the others; English is the fallback for any miss.

## Out of scope

- No DB schema, no edge functions, no role changes.
- No background polling beyond the existing `PermissionStatus.onchange` listener.
- No changes to room/ticket flows — they continue to use cached fixes when available.

## Files

**New**
- `src/components/dashboard/BrowserLocationHelpDialog.tsx`
- `src/lib/location-translations.ts` (optional split; otherwise append to `comprehensive-translations.ts`)

**Edited**
- `src/lib/locationPreference.ts`
- `src/components/dashboard/AttendanceTracker.tsx`
- `src/components/dashboard/SettingsDialog.tsx`
- `src/App.tsx`
- `src/lib/comprehensive-translations.ts` (or new translation module + register in `useTranslation.tsx`)
