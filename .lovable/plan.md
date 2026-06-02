## 1. Add Filipino (Tagalog) language — code `tl`

We currently support `en, hu, es, vi, mn, az`. Add Filipino as a first-class language (ISO `tl`, flag 🇵🇭, label "Filipino"). Tagalog is what most Filipinos read and speak; works for the housekeeper who speaks English but doesn't read it.

**Files to update (add a full `tl:` block parallel to the existing `mn:`/`vi:` blocks):**
- `src/hooks/useTranslation.tsx` — add `'tl'` to `Language` union + `supportedLanguages`, add full `tl` dictionary alongside `en/hu/es/vi/mn/az`.
- `src/components/dashboard/LanguageSwitcher.tsx` — add `{ code: 'tl', name: 'Filipino', flag: '🇵🇭' }`.
- `src/components/admin/TranslationManagement.tsx` — add Filipino to `LANGUAGES`, surface in editor + missing-count.
- All twelve translation modules with per-language bundles:
  - `comprehensive-translations.ts`, `expanded-translations.ts`, `screen-translations.ts`, `highlighted-translations.ts`, `training-translations.ts`, `maintenance-translations.ts`, `notification-translations.ts`, `pms-translations.ts`, `purchase-invoice-translations.ts`, `breakfast-translations.ts`, `guest-minibar-translations.ts`, `room-overview-translations.ts`.
- `src/lib/translation-utils.ts` if it enumerates languages.
- Persist `tl` via existing `profiles.preferred_language` (already free-form text, no migration needed) and `localStorage` `preferred_language` key.

**Translation source policy:** translate every existing English key into Filipino, mirroring the same key names. Filipino phrases will use everyday Tagalog (with the common English hospitality loanwords like "check-in", "room", "minibar" kept as-is, because that's how housekeepers actually use them). All 5 existing user-facing modules — housekeeping, maintenance, breakfast, PMS/front-desk, minibar, training, notifications, settings — get the same Filipino coverage we already give Vietnamese/Mongolian. No partial coverage; the goal is the housekeeper sees zero English in normal flows.

## 2. Location access — make it quiet and self-healing

**Goals**
- Don't ask anyone who already granted browser permission.
- Don't show banners during cleaning/tickets/anything that doesn't need a fix.
- Ask only when the user does an action that actually needs location (attendance sign-in).
- If the browser is `denied` or the app is blocklisted, guide the user to the exact OS/browser setting that fixes it.

**Changes to `src/lib/locationPreference.ts`**
- Add `syncOptInFromBrowser()`: if `getOptIn() === false` but `navigator.permissions` reports `'granted'`, auto-flip opt-in to `true` and immediately cache a fresh fix (silent — no prompt). Run this on app boot and whenever the Permissions API `change` event fires (subscribe in `useAuth` boot).
- Listener: in `requestLocationOnce`, attach `status.onchange` once per session so revoking in the browser flips our flag back to `false` without a refresh.

**Changes to attendance/sign-in flow (`AttendanceTracker.tsx`)**
- Remove the always-on `getCurrentLocation()` on mount for users whose permission state is `'prompt'` and who have never opted in. Only resolve silently when `granted`.
- `handleCheckIn` becomes the single trigger for the prompt: when the user clicks Sign In and we have no location, run `requestLocationOnce()` inline (which triggers the native browser prompt) before inserting the row. No banner needed unless the request fails.
- Banner copy gets a `locationStatus === 'denied'` variant with two buttons:
  1. **"Fix in browser"** — opens a new helper component `BrowserLocationHelpDialog` (see below).
  2. **"Open Settings"** — existing in-app settings card.

**New component: `src/components/dashboard/BrowserLocationHelpDialog.tsx`**
- Detects browser (Chrome/Edge/Safari/Firefox, desktop vs iOS vs Android) from `navigator.userAgent` + `navigator.userAgentData`.
- Shows step-by-step instructions with screenshots/icons for the matching browser, e.g. Chrome desktop: "Click the 🔒 lock icon → Site settings → Location → Allow". Includes a deep link where supported (Chrome `chrome://settings/content/location`, Edge `edge://settings/content/location`) — rendered as copy-to-clipboard since `chrome://` can't be navigated from a web page.
- Mobile iOS Safari: "Settings → Safari → Location → Ask/Allow → Reload this tab".
- Android Chrome: "Site settings → Permissions → Location → Allow".
- All copy goes through `t()` so it's also localized into the 7 languages including Filipino.
- Wired from both the attendance banner and the Settings → Location Access card (`SettingsDialog`) when `permState === 'denied'`.

**Settings → Location Access card (`SettingsDialog.tsx`)**
- Show "Enabled (already allowed by browser)" without a button when browser permission is `granted` and we have a cached fix — no second click needed.
- When `denied`, replace the text-only hint with the "Fix in browser" button that opens `BrowserLocationHelpDialog`.
- Localize the whole card (currently hardcoded English).

**Migration of existing users**
- On first load after this change, `syncOptInFromBrowser()` runs once. Anyone whose browser already says `granted` is silently upgraded to opt-in=true and a fresh fix is cached — they never see a prompt again.
- No DB migration needed; preference is purely client-side localStorage.

## 3. Out of scope

- No new tables, RLS, or edge function changes.
- No changes to attendance business rules; we only change *when* the prompt appears.
- No automatic background polling of geolocation.

## Technical notes

```text
Boot (useAuth)
 └─ syncOptInFromBrowser()          // silent upgrade if browser=granted
        └─ caches fix, sets opt-in=true

Sign In click
 ├─ have fix?  ── yes → insert attendance row
 └─ no  → requestLocationOnce()
            ├─ granted → cache + insert
            ├─ denied  → open BrowserLocationHelpDialog
            └─ dismissed → toast "Location needed to sign in"
```

Filipino dictionary additions are mechanical mirrors of the existing English keys; each translation file gains a `tl: { ... }` block of identical shape to `vi:`.

