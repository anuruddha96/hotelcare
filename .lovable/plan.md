## Add Russian (ru) language support

### Scope
Add Russian as a fully supported UI language across the entire app, prioritizing housekeeper-facing screens first, then manager-facing screens, then remaining admin/misc surfaces.

### Phase 1 — Wire up the language
1. Register `ru` in the language switcher (`src/components/dashboard/LanguageSwitcher.tsx`) with flag 🇷🇺 / name "Русский".
2. Add `ru` to the supported-language union/type in `src/hooks/useTranslation.tsx` and to the admin translation manager (`src/components/admin/TranslationManagement.tsx`).
3. Add `ru` bucket to every translation bundle file so lookups don't fall back to keys:
   - `src/hooks/useTranslation.tsx` (core bundle)
   - `src/lib/comprehensive-translations.ts`, `expanded-translations.ts`, `highlighted-translations.ts`, `screen-translations.ts`
   - Domain bundles: `maintenance-translations.ts`, `pms-translations.ts`, `notification-translations.ts`, `training-translations.ts`, `breakfast-translations.ts`, `purchase-invoice-translations.ts`, `room-overview-translations.ts`, `guest-minibar-translations.ts`, `location-translations.ts`, `linen-item-i18n.ts`, `translation-utils.ts`
4. Update `mem://index.md` Core to list `ru` as a supported UI language.

### Phase 2 — Housekeeper surfaces (translate first)
Cover every string a housekeeper sees:
- Attendance / sign-in / sign-out (`AttendanceTracker`, swipe-action labels)
- Housekeeping tab, My Tasks, Team View
- `AssignedRoomCard` (all states: assigned, in_progress, DND, DND retry, No Service, completed)
- Room checklist tiles: DND Photo, Dirty Linen, Minibar, Lost & Found, Maintenance
- Minibar item names and categories, Lost & Found items, Dirty Linen item names
- Structured/housekeeping notes labels, bed configuration labels, special instructions
- Timer / "Time on this room" labels
- All toasts, confirm dialogs, and error messages triggered from housekeeper flows

### Phase 3 — Manager surfaces
- Manager dashboard, Hotel Room Overview legend and status chips
- Supervisor Approval view (pending approvals, checkout/daily/DND/no-service cards, photo lightbox controls)
- Approval History, Early Sign-out approvals, Minibar Tracking room-chip dashboard, Dirty Linen Management summary
- Auto-Assign UI (chips, tap-to-move hints, per-housekeeper panels)
- Reassign / manual assign dialogs, notifications, messages
- Reception legacy view labels

### Phase 4 — Remaining app
- Admin panels (Users, Hotels, PMS config, Training admin, Translation Management UI)
- Revenue, Breakfast, Front Desk, Reservations, Purchase Invoices, Guest Minibar public page, Auth pages, NotFound, install prompt, headers, tab bars

### Translation approach
- Generate translations directly in code (no runtime AI calls) using consistent hotel-industry Russian terminology.
- Keep placeholders (`{{name}}`), punctuation, and casing patterns identical to English.
- Where a domain bundle already stores per-language maps (e.g. `linen-item-i18n.ts`, `translation-utils.ts`), add a parallel `ru` map with equivalent coverage to `uk`.

### Verification
- Typecheck passes with the widened language union.
- Switch app to Russian and spot-check via Playwright: housekeeper assigned-room card, minibar view, manager approval card, dirty linen summary, auto-assign — confirm no raw keys and no English leakage on translated screens.
- Confirm language preference persists (profiles.preferred_language accepts `ru`; it's a free-text column so no migration needed — will verify before build).

### Out of scope
- Translating user-generated content (guest notes, manager-authored messages) — only static UI copy.
- Right-to-left support (Russian is LTR, no layout changes needed).
