# Per-hotel pickup automation, off by default

## What's true today (verified)

- Automation rules are already stored **per hotel** (`revenue_pickup_automation_rules`, unique per hotel + rule name).
- Only one rule row exists: **Ottofiori**, enabled, +8/+18/+22 tiers, €120 ADR floor, €40 daily cap, last run 16:30 today.
- Memories, Mika and Gozsdu have **no rule row**, so the engine skips them entirely — they are already off, and nothing is created automatically.
- The engine only processes rows with the switch on, so it is genuinely independent per property.

So the behaviour you asked for is mostly in place. What's missing is the *visibility and safety* around it — right now you can't tell from the calendar which hotel is automated, and opening the sheet on a new hotel shows pre-filled numbers that look like they're already live.

## Changes to make (UI only)

1. **Show the state on the button.** The "Automation rules" button in the Rate & pickup calendar shows a clear badge: "Automation: On" (green) or "Automation: Off" (grey) for the hotel currently open.
2. **Name the hotel in the sheet.** Header becomes "Pickup price automation — Hotel Memories Budapest", so there's no doubt which property you're editing.
3. **Make "off by default" explicit.** When a hotel has no saved rule, the sheet clearly says "Automation has never been set up for this hotel. It is off." The number fields still show suggested starting values, but they are labelled as suggestions, not active settings.
4. **Confirm before turning on.** Switching the toggle on and saving asks for a short confirmation naming the hotel and whether prices will be published to Previo automatically.
5. **Plain-English summary stays**, but when the rule is off it reads "Nothing will change automatically for this hotel" instead of describing live behaviour.
6. **Copy the settings from another hotel** (optional convenience): a small "Copy settings from…" picker that fills the form from another property's saved rule, still leaving the switch off until you turn it on.

## Not changing

- No database changes needed — the table and its per-hotel uniqueness already support this.
- The engine, tier maths, ADR floor, daily cap and cron schedule stay exactly as they are.
- Ottofiori stays on and untouched.

## Technical notes

- All edits in `src/components/revenue/PickupAutomationRules.tsx`, plus passing a hotel display name from `RateStrategyGrid.tsx`.
- Track a `hasSavedRule` flag from the initial `maybeSingle()` load to drive the "never configured" copy and the badge state.
- Confirmation uses an AlertDialog before the upsert when moving from off to on.
