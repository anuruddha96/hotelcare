
## Plan

Five focused changes. All UI/presentation — no business-logic rewrites.

### 1. Ukrainian training translations
**Problem:** `LangCode` includes `'uk'` but none of the curricula in `src/components/training/v2/curricula/*.ts` have a `uk:` field, so `tx()` falls back to English for every step title, body, and CTA even when the housekeeper's UI is Ukrainian.

**Fix:** Add `uk:` translations to every `I18nText` block in:
- `housekeeper.ts` (13 steps + curriculum name/description)
- `manager-complete.ts`, `manager.ts`, `manager-attendance.ts`, `manager-team.ts`, `manager-tickets.ts`, `manager-reception.ts`, `manager-revenue.ts`, `manager-invoices.ts`
- `autoAssignPromo.ts`, `admin-pms-overview.ts`
- Also fill `uk` entries in the toast label maps inside `TrainingV2Provider.tsx` (SKIP_TOAST_LABELS, RESUME_TOAST_LABELS, notNowLabel, HEADER in `TrainingHelpButtonV2.tsx`, "Start tour" / "Remind me tomorrow" / "Skip" strings in `TrainingFirstLoginPrompt.tsx`).

### 2. Redesign the "Required Actions" panel (AssignedRoomCard.tsx lines 1109-1206)
Current UI reads like an error banner (red gradient + pulsing warning + "MANDATORY" chip). Replace with a modern, inviting checklist card:

- Container: soft neutral surface (`bg-card` with `border-border`), rounded-2xl, subtle shadow. No red gradient, no pulse.
- Header: small icon (ClipboardCheck) + "Room checklist" title in `text-foreground`, muted subtitle "Complete any that apply before finishing".
- Buttons: keep 6 actions but restyle as uniform tile cards (icon in a tinted circle, label below). Each tile uses a single tonal accent (primary/secondary) instead of 6 different colored borders. Add subtle hover lift.
- Fix maintenance UK overflow: use `text-[11px] leading-tight break-words hyphens-auto` with `min-h-[72px]` so long words like "Технічне обслуговування" wrap cleanly.
- Show a small green check dot on tiles the housekeeper has already interacted with (dirty linen submitted, minibar recorded, etc.) using existing state flags already available on the card.

### 3. Pre-completion confirmation dialog
Before `updateAssignmentStatus('completed')` fires from the Complete hold-button, open a small confirmation dialog asking:
- "Have you added all dirty linen collected from this room?" (Yes / Go back)
- "Have you recorded minibar consumption (if any was used)?" (Yes / Go back)

Implementation: new `PreCompleteChecklistDialog.tsx` (two checkboxes + primary "Complete room" button, secondary "Not yet"). Wire it into `AssignedRoomCard` — the hold-complete handler opens the dialog; only when both are checked does it call the existing completion mutation. No backend changes.

### 4. Lost & Found dialog UX overhaul (`LostAndFoundDialog.tsx`)
Reorder + upgrade to a 3-step flow inside the same dialog:

1. **Photo first** — big camera CTA (Take photo / Upload) with a preview thumb.
2. **Item picker** — replace the free-text `Input` with a Command/Combobox (shadcn `Command`) seeded with a curated list of ~40 common lost items (umbrella, wallet, passport, phone charger, sunglasses, laptop, headphones, jewellery, keys, book, cosmetics, clothing items, toys, medication, etc.), translated for all supported UI languages including `uk`. As the user types, filter by prefix and rank by a small "most-used" weight (static ordering per item). Allow free-text "Custom item" fallback.
3. **Description / notes** — optional textarea, then Report.

Add a stepper indicator at the top; keep Cancel + Report actions in the footer. Item list lives in a new `src/lib/lostFoundItems.ts`.

### 5. Minibar dialog polish
Sweep the existing minibar dialog(s) opened from `RoomDetailDialog` / minibar tile:
- Larger touch targets, grouped by category (Drinks, Snacks, Other) with sticky category chips.
- Quantity stepper (− / value / +) instead of tiny inputs.
- Running total pill at the bottom with clear "Save" primary button.
- Empty state illustration + "Nothing consumed" quick-confirm button so housekeepers can dismiss in one tap.
- Full UK translations for all labels.

### Technical notes
- No schema changes, no edge-function changes.
- New files: `src/components/dashboard/PreCompleteChecklistDialog.tsx`, `src/lib/lostFoundItems.ts`.
- Edited: all curricula files, `TrainingV2Provider.tsx`, `TrainingHelpButtonV2.tsx`, `TrainingFirstLoginPrompt.tsx`, `AssignedRoomCard.tsx`, `LostAndFoundDialog.tsx`, minibar dialog component(s) under `src/components/dashboard/`, `useTranslation.tsx` (new UK strings for checklist + lost&found + minibar labels).
- Verify with existing curricula tests (`__tests__/curricula.test.ts`) and a UK-language pass on the housekeeping dashboard.
