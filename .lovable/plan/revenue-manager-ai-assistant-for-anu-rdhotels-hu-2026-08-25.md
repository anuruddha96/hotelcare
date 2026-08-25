# Revenue-manager AI assistant for anu@rdhotels.hu

Turn the existing Hotel Care Assistant into a portfolio-wide revenue advisor for
`anu@rdhotels.hu` (role `top_management_manager`, organization `rdhotels`), able to read every RD
Hotels property, reason like a 20-year revenue manager, and propose concrete automation-rule changes
that the user approves with one tap. Mobile-first.

## 1. Access

- Assistant is currently visible only to `role === "admin"` in `AssistantLauncher` and
  `AssistantPage`. Add a small allowlist helper so it also opens for this user
  (matched on profile id / email), keeping every other non-admin role hidden.
- Backend scope stays derived from the signed-in profile only — never from the browser.

## 2. Portfolio scope inside one organization

Today every assistant tool filters `hotel_id = profile.assigned_hotel` (ottofiori only).

- Add a server-side hotel resolver: for `admin`, `top_management*` and `manager` roles, list all
  hotels of `profile.organization_slug` (from `hotel_configurations`); every other role stays pinned
  to `assigned_hotel`.
- Every tool keeps a hard `organization_slug` filter and now accepts an optional `hotelId` that must
  be inside the resolved list; omitted means "all my hotels", returned per hotel.
- Cross-organization data stays unreachable for everyone except `admin`.

## 3. Revenue brain: new read tools

Added only for callers with the `revenue` scope, all org+hotel filtered:

- `get_pickup_and_pace` — rooms sold vs. available and pickup movement by stay date over a horizon,
  from the pickup movement / snapshot sources the Revenue page already uses.
- `get_rate_calendar` — current published prices, min-stay and sold-out state per date and room type.
- `get_automation_rules` — the full current `revenue_pickup_automation_rules` row(s) per hotel plus
  last run status and error.
- `get_automation_activity` — recent `revenue_pickup_automation_actions`: what the engine changed, why,
  and whether it published.
- `get_demand_context` — `demand_events` / demand ratings for the date range, so events justify pricing.
- Existing `get_revenue_metrics`, `get_occupancy`, housekeeping / maintenance / reception tools stay,
  widened to the portfolio scope above.

## 4. Amending automation rules — propose, then confirm

- New tool `propose_automation_change`: the model passes a hotel, a set of rule fields with new values
  and a reason. The backend validates every field against an explicit allowlist of the numeric/boolean
  columns on `revenue_pickup_automation_rules` (markdown steps, lead bands, floors, occupancy guards,
  far-out top-up, min ADR, max increase/decrease, enable switches, run interval…), clamps them to safe
  ranges, and returns a **before → after diff**. Nothing is written at this step.
- The diff renders in chat as a card listing each field, old value, new value and the reason, with
  **Apply** / **Dismiss**.
- Apply calls a new edge function `assistant-apply-automation-change` that re-authenticates the user,
  re-checks role + organization + hotel, re-validates the same allowlist and ranges, writes the row
  (bumping `version`, `updated_by`), and records the change in the assistant audit log.
- Autonomous/unattended changes are explicitly out of scope for this phase; the assistant only reads
  and proposes.

## 5. The 20-year revenue manager persona

System prompt gains an explicit revenue-management playbook, in the user's language:

- Goal: sell early, build occupancy toward 100% per day, protect ADR — never discount blindly.
- Always ground answers in tool data; state hotel, date range and currency; say plainly when data is
  missing instead of guessing.
- Reason across pickup pace, lead time, day of week, events and remaining rooms before suggesting a
  rule change; quantify the expected effect and the risk.
- Respect the app's existing guardrails (whole-number prices, ladder/hierarchy safety, sold-out and
  high-occupancy guards, min ADR, far-out floors) and mention them when relevant.
- Model: the strongest available reasoning model with medium-to-high effort, tool loop up to 50 steps.

## 6. Modern, mobile-first chat

Rebuild the assistant shell around the existing AI Elements primitives:

- Mobile: full-screen sheet sized from `visualViewport`, single close control, safe-area aware,
  sticky composer, 16px input font (no iOS zoom), transcript scrolls independently, no layout jump when
  the keyboard opens/closes.
- Modern chat features: streaming answers with a visible thinking state, stop/regenerate, copy answer,
  suggested starter prompts ("How is next weekend pacing?", "What should I change to fill Sunday?"),
  tool-activity chips showing which data was read, markdown/tables, mic dictation kept, auto-scroll
  with jump-to-latest, thread history as tappable rows with preview + time, new chat, and a
  clear inline error when the model or a tool fails.
- Desktop keeps the side panel and the full-page `/rdhotels/assistant/:threadId` view with Back.

## Technical notes

- `supabase/functions/assistant-chat/index.ts`: hotel resolver, widened + new tools, propose tool,
  persona prompt, model bump. Keeps thread-ownership verification and audit logging.
- New `supabase/functions/assistant-apply-automation-change/index.ts` plus a shared
  `_shared/assistantAutomationFields.ts` allowlist used by both functions.
- `src/components/assistant/*`: mobile shell, diff/apply card, starter prompts, tool chips.
- `src/hooks/useAssistant.ts`: portfolio-aware thread scoping.
- No changes to the pricing engine, Previo publishing, billing, auth or housekeeping logic; rule rows
  are only written through the validated apply path the user confirms.

## Verification

- Sign in as anu@rdhotels.hu on a phone-sized viewport: open, type, send, stream, keyboard open/close.
- Ask a portfolio question and confirm all RD Hotels properties appear and no other organization does.
- Ask for a rule change, inspect the diff, Apply, then re-read the rule row to confirm the new values
  and version bump, and confirm the audit entry.
- Confirm a housekeeping-role and a different-organization account see neither the button nor the data.
