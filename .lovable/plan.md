# Show AI edits vs automation edits in Revenue notifications

Kept deliberately small (one focused edit, no database changes) to fit the ~4-credit budget.

## What the user will see
- Each notification gets a clear source tag instead of the generic "Pricing" chip:
  - **AI** — changes made by the HotelCare AI supervisor or the Assistant
  - **Automation** — scheduled pricing / minimum-stay engine runs
  - **Manual** — runs someone started by hand (shows their name)
- A small filter row at the top of the panel: **All · AI · Automation · Manual**.
- Shorter, clearer lines, e.g.:
  - "53 dates · 689 prices sent to Previo"
  - "16 prices sending to Previo…"
  - "Failed: 3 prices not accepted" (red only when something failed)
- The robot icon changes per source (sparkle-style AI mark vs gear for automation) so it's readable at a glance on mobile.

## Root cause
The notifications loader overwrites the actor for every automatic row with "Automatic pricing", so rows written by the AI supervisor ("HotelCare AI supervisor") look identical to engine runs.

## Technical details
- `src/hooks/useRevenueAutomationNotifications.ts`: stop overwriting `actor_name`; add a derived `source: 'ai' | 'automation' | 'manual'` (AI when actor/notification type indicates the AI supervisor or Assistant, automation when `run_source === 'automatic'`, else manual).
- `src/lib/revenue/automationSummary.ts`: shorten the headline strings shown above.
- Notification panel component (the one rendering the "Revenue automation" list): source chip with design tokens, icon per source, filter chips with local state.
- Assistant price edits (`assistant-apply-action`) currently only write to the audit log, not the notification list — not included in this small edit; can follow up if you want Assistant edits listed too.
