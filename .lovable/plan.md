

## Plan: Fix White Screen After Coffee Table Photo + Add Android PWA Install

### Issue 1: White screen after coffee table photo capture (Natali's bug)

**Investigation needed**: I need to inspect the photo capture flow in `EnhancedImageCaptureDialog.tsx` / `SimplifiedPhotoCapture.tsx` / `CompletionChecklistDialog.tsx` to find what happens specifically after the coffee table photo step. Likely root causes (based on prior similar issues):

1. **Async gesture-chain break**: After `await` on a heavy operation (image compression, upload, base64 conversion), the next photo input click silently fails on Android Chrome, leaving a blank state.
2. **Memory pressure**: Large base64 previews (Object URLs not revoked) accumulate, causing the WebView to crash/blank on mid-range Android devices after several captures.
3. **State race**: `currentStep` advances but the next step's render throws (e.g., undefined photo type), and the error boundary shows nothing.

**Fix approach**:
- Wrap the capture/upload flow in try/catch with a visible fallback UI (no more silent white screen).
- Revoke `URL.createObjectURL` previews after upload; convert/compress images via `createImageBitmap` + canvas instead of FileReader base64 to cut memory ~4x.
- Pre-create the next file input synchronously inside the click handler, then run async upload after — preserving the gesture chain on Android.
- Add an error boundary around the checklist dialog content so a render error shows a "Retry" button instead of a blank screen.
- Add console logging at each step transition so future reports surface in logs.

### Issue 2: Android install-to-home-screen + push notifications

The app already has `public/service-worker.js` and `serviceWorkerManager.ts` registered (visible in console: "Service Worker registered successfully"). What's **missing** for Android install:

1. **`public/manifest.webmanifest`** with `name`, `short_name`, `start_url: "/"`, `display: "standalone"`, `background_color`, `theme_color`, and `icons` (192px + 512px, with `purpose: "any maskable"`).
2. **`<link rel="manifest">`** + theme-color meta in `index.html`.
3. **PWA icons** in `/public/` (192, 512, maskable variants) — generated from existing favicon/logo.
4. **Install prompt UI**: Capture `beforeinstallprompt`, show a small "Install App" button in the Header (Android Chrome only — iOS Safari uses the existing add-to-home-screen instructions). Hide once installed (`appinstalled` event or `display-mode: standalone`).
5. **Service worker tweak**: Existing SW is fine for notifications; just ensure it doesn't aggressively cache HTML (current code has empty fetch handler — good, no cache pollution risk).

**Important PWA constraints from project guidelines**:
- Do NOT add `vite-plugin-pwa` (it caches builds and breaks the Lovable preview iframe).
- The existing manual SW already skips caching — we keep it that way.
- Guard the install banner to only render outside iframes / preview hosts so the editor preview isn't affected.
- Notifications already work (existing `useNotificationPreferences` + service worker push handler) — we just make sure the install flow surfaces the "Enable notifications" banner right after install.

### Files to change

| File | Change |
|------|--------|
| `src/components/dashboard/SimplifiedPhotoCapture.tsx` (and/or `EnhancedImageCaptureDialog.tsx`) | Wrap capture in try/catch, revoke object URLs, preserve gesture chain, add step logging |
| `src/components/dashboard/CompletionChecklistDialog.tsx` | Wrap checklist body in error boundary with Retry |
| New: `src/components/ErrorBoundary.tsx` | Reusable error boundary |
| New: `public/manifest.webmanifest` | PWA manifest |
| New: `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png` | PWA icons (generated from existing branding) |
| `index.html` | Add `<link rel="manifest">`, theme-color, apple-touch-icon |
| New: `src/components/InstallAppPrompt.tsx` | `beforeinstallprompt` capture + install button (Android Chrome) |
| `src/components/layout/Header.tsx` | Mount `<InstallAppPrompt />` |
| `public/service-worker.js` | Minor: ensure no HTML caching (already fine), keep push handler |

### Out of scope / notes
- True native Android app (Capacitor) is **not** included — the user asked for "download to home screen and work like an app", which is exactly the PWA install flow above.
- iOS users keep the existing add-to-home-screen instructions (iOS doesn't support `beforeinstallprompt`).

