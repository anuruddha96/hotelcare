## Legend↔chip sync, admin PMS-Upload toggle discoverability, admin-only Yesterday/Today, training module

Three self-contained pieces of work. All frontend-only except for optional PMS Config link — no live-assignment writes, no edge function changes.

---

### 1. Legend ↔ room-chip audit (both directions)

Today `HotelRoomOverview.tsx` has three parallel places that must stay in lock-step: the legend array (lines 1476–1497), `renderRoomChip` (line 501), and `renderReadOnlyChip` (line 1086). They have drifted — some chip badges have no legend entry, and some legend entries never render.

**What to do**

- **Extract one shared source of truth** — a `LEGEND_ITEMS` array at module scope with `{ key, label, hint, className, kind: 'swatch'|'badge'|'ring'|'emoji', renderCondition(room, assignment) }`. The legend maps over it directly; `renderRoomChip` and `renderReadOnlyChip` iterate the same list to decide which badges/rings/emojis to draw.
- **Reconcile the current drift** by walking each legend row and each `renderRoomChip` conditional side-by-side. Concretely I already see:
  - `RTC / Ready to Clean` legend entry exists, but the chip only shows an `RTC` badge for one specific status combination — confirm which flag drives it and either widen the chip check or narrow the legend copy.
  - `Extra Towels` shows a 🧺 emoji on the chip but the legend renders it as a colored text swatch — normalize to the emoji.
  - `Clean Room` legend text `C` swatch is drawn on the chip only via `roomFlags.roomCleaning`; there's no `C` (linen change) badge check on the read-only chip. Add it.
  - `SH` (Shabbath), `NS` (No Service), `C/O` short-code badges appear on chips but have no legend row — add them, or remove them from the chips if they duplicate the ring/emoji.
  - `📝` note indicator under the chip is not in the legend — add "Has note" row.
- **Read-only chip parity** — `renderReadOnlyChip` must call the same helper so yesterday's chips carry every indicator the today chip does. Snapshot data (`is_dnd`, `is_no_show`, `towel_change_required`, notes, etc.) already lives on the `rooms` row from the yesterday query — reuse it.
- **Unit test** (new file) enumerates every `LEGEND_ITEMS[].key` and asserts each has both a legend label and a chip render path.

---

### 2. Admin PMS Upload toggle — discoverability + mobile admin tabs

The toggle already exists (`hide_pms_upload_page` switch in `PMSConfigurationManagement.tsx` line 443) but the user couldn't find it, and the admin tabs bar doesn't scroll on mobile.

**What to do**

- **Answer:** Path is **Admin → PMS Config → select hotel → "Hide legacy PMS Upload tab"** switch (under Snapshot/Push toggles). I'll add a small blue info banner at the top of `PMSConfigurationManagement` that names this switch and briefly explains it, so it's obvious.
- **Fix mobile scroll on `AdminTabs.tsx`** — wrap `<TabsList>` in a horizontally-scrollable container: `<div className="w-full overflow-x-auto -mx-2 px-2"><TabsList className="w-max min-w-full">…</TabsList></div>`. This preserves the desktop layout but lets the mobile bar swipe horizontally. Same pattern already used elsewhere in the app.
- **Bonus discoverability** — inside the PMS Upload tab in `HousekeepingTab`, show a tiny "Admin: this tab can be hidden from PMS Config" hint that only admins see. One line, ghost styling.

---

### 3. Simplify Yesterday/Today split — admin-only

Right now every manager sees the two-column Yesterday/Today layout. User wants:

- **Admins & top_management**: keep the current two-column Yesterday + Today view (desktop) / Today-only (mobile — already done).
- **Everyone else eligible** (`manager`, `housekeeping_manager`, front_office, etc.): **always** see only the Today column, desktop and mobile.

**What to do**

- In `HotelRoomOverview.tsx` `renderSection`, replace the current `hideYesterdayOnMobile` check with `showYesterdayColumn = profile?.role === 'admin' || profile?.role === 'top_management'` (mobile hidden already; this just extends it to desktop for non-admins).
- Skip the whole yesterday fetch when `!showYesterdayColumn` — saves one query per load for the majority of users.
- **Section header count** — when yesterday is hidden, drop the "carried / previous" annotation so managers just see the plain room count for today.
- **Sync-success animation** — the emerald ring + `CheckCircle2` scale-in on `PmsSyncControls` (line ~187) already works but is only ~1.4s. Extend the toast with a subtle Sparkles icon + slower fade (2.2s) and add a matching brief green ring pulse on the room-overview card border on the same event via a shared `pms-sync-completed` window event that `HotelRoomOverview` listens for.
- Confirm `PmsRefreshButton` (Team View entry point) fires the same event so both entry points get the celebration.

---

### 4. Training module for the new features

`managerTeamCurriculum` already has a `pms_refresh` step. Extend and register properly so admins can take the full course from Training Center.

**What to do**

- Add three new steps to `manager-team.ts`:
  - `yesterday_vs_today` — points at the yesterday column with copy "Left = yesterday's finished work (read-only). Right = today's rooms you can assign. Non-admin managers only see today."
  - `legend_expanded` — points at the legend, explains that every colored swatch and letter badge on room chips is documented here and always in sync.
  - `hide_pms_upload_admin_only` — admin-scoped step (guarded via `roles`) pointing at the Admin → PMS Config → Hide toggle.
- Create a new short **admin-only** curriculum `pmsOverviewAdminCurriculum` (`slug: v2_admin_pms_overview`, `roles: ['admin']`, `category: 'feature_promo'`, `priority: 15`) that walks the Admin PMS Config screen: select hotel → set credentials → run test → toggle hide-upload → save. Register it in `src/components/training/v2/curricula/index.ts`.
- Ensure the tour tiles surface in `TrainingCenter` — they will automatically once the curricula are registered and role matches.
- Add translations for all new step titles/bodies in en/hu/es/vi/mn.

---

### Out of scope

- No changes to edge functions, DB migrations, outbound push wiring, or live assignments.
- No changes to non-admin users' Yesterday data storage — it just isn't rendered for them.
- No redesign of legend layout — same 2-column grid, only content reconciled.

### Files touched

- `src/components/dashboard/HotelRoomOverview.tsx` — legend/chip shared source, admin-only yesterday column, sync animation broadcast.
- `src/components/admin/AdminTabs.tsx` — mobile-scrollable tab bar.
- `src/components/admin/PMSConfigurationManagement.tsx` — info banner above the switch.
- `src/components/dashboard/HousekeepingTab.tsx` — small admin hint on PMS Upload tab.
- `src/components/pms/PmsSyncControls.tsx` + `src/components/dashboard/PmsRefreshButton.tsx` — richer success animation + shared window event.
- `src/components/training/v2/curricula/manager-team.ts` — new steps.
- `src/components/training/v2/curricula/admin-pms-overview.ts` (new) + `src/components/training/v2/curricula/index.ts` — register curriculum.
- `src/lib/highlighted-translations.ts` + training-translations — new keys in 5 languages.
- New unit test: `src/components/dashboard/__tests__/legend-chip-parity.test.ts`.
