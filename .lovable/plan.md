# Revenue Management upgrade + in-app AI assistant

Two phases. Phase A (Revenue) ships first, Phase B (assistant) second.

## Phase A — Revenue Management

### A1. Negative pickup is never recorded (root cause)

Verified in the database: `revenue_cancelled_nights` currently holds **zero rows**, while
`revenue_daily_snapshots` holds real per-date history (Aug 5 and Aug 6 captures). So the app can only
ever draw positive pickup — exactly what Previo shows as `-1` on Aug 16-18 is invisible here.

The sync pulls reservations with a stay-date term filter and only marks a night cancelled when the
reservation comes back with status 6/8. Nothing cancelled is arriving, so either the Previo search is
excluding cancelled reservations by default, or the cancellation timestamp tag is different from the
ones we look for.

Fix, in order:
1. Read-only probe against Ottofiori's Previo credentials to see whether cancelled/no-show
   reservations come back at all, and under which tag the cancellation moment lives. Report exactly
   what is returned.
2. Sync: request cancelled reservations explicitly (status filter / the cancellation-aware method the
   probe confirms), and store each cancelled room-night with a true cancellation timestamp.
3. Safety net regardless of the probe outcome: derive net movement per date from the snapshot series
   (rooms sold today vs rooms sold at the start of the pickup window). This alone reproduces Previo's
   `-1` numbers from data we already store, and becomes the fallback when a cancellation timestamp is
   missing. Positive pickup keeps its current, working calculation — the snapshot delta is only used
   when it disagrees downward.
4. Verify against the attached Previo report: Aug 12 `+2`, Aug 14/15 `+1`, Aug 16/17/18 `-1`.

### A2. Pickup window control

- The pickup window becomes user-adjustable from the header: today, yesterday+today, 3d, 7d, 30d, and
  a custom date range.
- The stay-date horizon it scans defaults to **today .. +6 months**, so "pickup today" counts every
  movement made today for any arrival date in the next six months.
- The window choice drives the KPI cards, the horizon chart and the calendar heat together, so the
  page never mixes two windows.

### A3. Monthly KPI header

A month selector above the KPIs (arrow left/right + month picker). Changing it recalculates, for that
month only: occupancy, ADR, RevPAR, room-nights sold, rooms left to sell, and revenue on the books.
Each card keeps a hover/tap explanation (RevPAR = ADR x occupancy).

### A4. Rooms left to sell

- Per date, per room type: a compact "3 left of 10" chip in the rate calendar, colour-graded from
  plenty-left to sold out, plus a house-level "11 left to sell" figure on the occupancy row.
- Modern readable presentation rather than the PMS's dense tick/cross grid: number + thin capacity
  bar, sold-out cells clearly marked.

### A5. Demand row in the Rate & pickup calendar

Directly under Pickup and Occupancy, a **Demand** row per date showing Low / Medium / High / Very high
with colour coding, using the existing internal demand grade (booking pace vs comparable weekdays,
pickup momentum, rooms left vs lead time, recorded events, and any manual manager override). Tapping a
date explains the drivers behind that grade.

### A6. Page ordering

The Revenue page is reordered so decisions come first and plumbing last:
1. Month KPIs (occupancy, ADR, RevPAR, revenue, rooms left) + pickup window control
2. Rate & pickup calendar (pickup / occupancy / demand / rooms left / prices)
3. Pickup and occupancy horizon chart
4. Today's sales and ADR goal
5. AI intelligence, recommendations and demand board
6. Events, outcomes, rate-plan mapping, sync history, settings (collapsed by default)

Mobile-first throughout: sticky room-type column, sticky month band, thumb-sized controls.

## Phase B — In-app AI assistant

An always-available assistant for **admin, top management, manager and reception** users. Its job is to
help people find and use features ("how do I assign a room", "how do I unassign", "where is the linen
count"), answer questions from the app's own data within the asker's permissions, and handle light
general questions.

- **Identity**: a named assistant with a short tagline (e.g. "Ask anything") and a generated logo — not
  a generic sparkle icon.
- **Placement**: a floating button visible on every authenticated page, opening a panel on desktop and a
  full-height sheet on mobile, without covering primary actions.
- **Conversations**: threaded chats with a thread list, a new-chat action, and each thread on its own URL
  so a reload restores it. Stored in the database, scoped to the signed-in user.
- **Answers**: streamed, markdown-rendered, in the user's selected app language (en/hu/es/vi/mn/ru/uk).
- **Attachments**: users can attach images (e.g. a screenshot of the screen they're stuck on).
- **Model routing**: the app grades each question and picks the model itself — a fast, cheap model for
  simple "where is X" and general questions, the strongest model for analysis. Uses your own OpenAI key
  (`OPENAI_API_KEY`), not the Lovable gateway.
- **Knowledge**: a searchable index of app how-to guidance (built from the existing training curricula
  and feature docs) so answers cite the real workflow rather than being invented.
- **Permissions and safety**: every answer is produced server-side under the asker's role, hotel and
  organization. Guest personal data, credentials, financials outside the asker's remit, and other
  sensitive fields are never returned; an attempt to extract them returns a polite refusal and raises an
  alert to admins.
- **Admin insight**: an admin-only view of what users are asking, anonymised, with common topics and
  unanswered questions, for training purposes. Users never see this.

## Technical notes

- `previo-revenue-sync`: cancellation-aware reservation pull; a read-only probe first.
- `src/lib/revenueAnalytics.ts`: snapshot-delta net pickup, month aggregates, rooms-left per date/type.
- `src/components/revenue/RateStrategyGrid.tsx`: demand row, rooms-left chips, window-aware heat.
- `src/pages/RevenueHotelDetail.tsx`: month selector, KPI header, section reordering.
- Assistant: new tables for threads, messages and (anonymised) question analytics with RLS scoped to the
  owner plus an admin read path; a Supabase Edge Function calling the OpenAI Responses API with
  streaming, structured tool access to a small set of read-only, role-filtered data lookups; UI built on
  AI Elements.

## Not in scope yet

Writing prices back to Previo automatically stays manual/approval-based until you confirm write access;
the assistant will not change data in this phase.
