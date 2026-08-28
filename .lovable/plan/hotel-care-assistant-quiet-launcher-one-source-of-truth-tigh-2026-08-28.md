# Hotel Care Assistant: quiet launcher, one source of truth, tighter answers

Scope is the assistant only. No changes to housekeeping, PMS sync, revenue automation, pricing rules, permissions, tenant isolation, rate publishing or Previo behaviour.

## What I confirmed in the code

- `src/components/assistant/AssistantLauncher.tsx:34-36` has `useEffect(() => { if (threadId) setOpen(true); }, [threadId])`. Because the active thread is stored in the URL as `?assistant=<id>` and written with `replace`, any refresh or navigation that keeps that parameter re-opens the drawer. That is the exact cause of the auto-open.
- `src/components/assistant/AssistantChat.tsx:510` sets `autoFocus` on the composer, so the iOS keyboard opens the moment the panel appears.
- The Revenue UI reads one authoritative dataset: `useRevenueHotelData` calls the `get_revenue_published_payload` RPC and derives rooms available (sellable room types, inflation guard against the snapshot, `sellable_rooms` override) plus all day metrics via `buildDayMetrics` in `src/lib/revenueAnalytics.ts`, with currency scaling from payload settings.
- The assistant does not use that dataset. `supabase/functions/assistant-chat/index.ts` queries `revenue_daily_snapshots` (`get_revenue_metrics`, `get_occupancy`, `get_pickup_and_pace`) and `revenue_room_type_rates` (`get_rate_calendar`) directly, taking the newest capture per stay date. That path skips the room-type inventory rules, the sold-out/cancellation handling and the currency scaling, so it can legitimately disagree with the screen.
- `stopWhen: stepCountIs(50)` (line 1432) and thread replay `limit(200)` (line 1321).
- Feedback is stored in `assistant_feedback` with `helpful` and a free-text `reason`; `AssistantInsights` already reads audit log, feedback and issue reports.

## Changes

### 1. Never auto-open
- Delete the open-on-threadId effect. The drawer opens only from the launcher button.
- Keep the active thread in component state instead of driving open state from the URL; when the drawer closes, remove the `assistant` query parameter. Threads and messages are untouched and stay listed under History.
- The full-page `/assistant/:threadId` route keeps its URL-driven behaviour.

### 2. Quiet, simpler shell
- One floating launcher: "Ask HotelCare" on desktop, icon-only compact on mobile. No greetings, no auto-start.
- Replace the Chat/History/Requests tab bar with a title row plus small icon actions: New chat, History (popover list), Close. Access Requests stays for approvers behind a small menu entry in the same row.
- Empty state: "What can I help you with?" plus exactly three page-aware suggestions.

### 3. Mobile input
- `autoFocus` only when not mobile. Existing `visualViewport` keyboard sizing stays as-is.

### 4. Same source of truth for Revenue
- Add `supabase/functions/_shared/revenuePayload.ts`: loads `get_revenue_published_payload` for a hotel (service role, after the existing org/hotel authorization check) and derives rooms available, occupancy, rooms sold, ADR, revenue, pickup and rates with the same rules as the UI, including the room-type inflation guard, `sellable_rooms` override and currency scaling.
- Keep it plain TypeScript with no Deno APIs so a vitest parity test can import it alongside `src/lib/revenueAnalytics.ts` and assert identical numbers on the same payload fixture.
- Rewire `get_occupancy`, `get_revenue_metrics`, `get_pickup_and_pace` and `get_rate_calendar` to that module. Raw snapshot/rate tables are only a fallback when no completed payload exists, and that fallback is reported as partial.
- Every revenue tool result gains `{ source: "revenue_published_payload", dataAsOf, lastSyncAt, confidence }`. Operational tools (housekeeping, reception, maintenance, invoices) gain the same envelope from their own source timestamps.

### 5. Answer contract
- Rewrite the system prompt: lead with the answer, concise by default (1-4 short paragraphs or 3-6 bullets), exact numbers/room numbers/hotel/date, tables only for multi-hotel, multi-date, room-type or KPI comparisons.
- Grounding rule: any factual HotelCare question must be answered from a tool call made in the current turn; conversation history is context, never evidence. If the lookup fails: "I couldn't verify the latest HotelCare data just now."
- Confidence handling is internal (verified / partial / unverified) and drives wording only; no percentages shown.
- Freshness: mention the dataset time when data is stale, incomplete, or when the user questions a number.
- Correction: on "that's wrong" / "check again", re-run the authoritative lookup for the named hotel and date and state the corrected figure without defending the old one.
- Hotel/date resolution: use the page context hotel when present, ask one short clarification when genuinely ambiguous, resolve relative dates in Europe/Budapest.
- Recommendation questions still gather the deeper evidence set; simple factual questions answer after one read.

### 6. Budget
- `stepCountIs(50)` becomes `stepCountIs(12)`; model context trimmed to the most recent 40 messages while the full thread stays stored and displayed.

### 7. Page-aware starters
- Extend `src/lib/assistant/starters.ts` with per-module sets (Revenue, Housekeeping, Maintenance, Purchase Invoices, Reception) selected from `useAssistantContext().module`, still filtered by role, three shown at a time.

### 8. Navigation and actions
- Navigation answers stay one line plus the existing action button, sourced from `navigationRegistry`.
- The proposal/confirmation architecture for writes is unchanged.

### 9. Failure states and feedback
- Map tool/network errors to plain sentences with a Try again button; technical detail stays behind the existing admin Debug mode.
- Thumbs-down opens compact reason chips (Incorrect, Outdated, Too long, Didn't answer, Wrong hotel, Other) saved into the existing `assistant_feedback.reason`.
- Assistant Insights gains helpful %, a breakdown by feedback reason, count of turns where a required lookup failed, and the most common question categories, under the existing access control.

## Tests
- Vitest: parity between the shared revenue derivation and `buildDayMetrics` on a fixture payload (occupancy, ADR, rooms available); stale payload marks partial; launcher does not open with an `assistant` query parameter present; drawer state survives route change; starter selection by module and role; history trimming keeps stored messages intact.
- Deno tests for the assistant tools: unauthorized hotel and cross-organization requests return nothing; missing PMS data does not become "0 arrivals"; tool failure returns an unverified envelope rather than data.
- Browser pass for the four auto-open scenarios (refresh, thread selected then navigate, resume, full-page route).

## Validation report
After implementation I'll report cause and fix of the auto-open, files changed, UI and answer-style changes, the revenue source now used and its parity proof, freshness and correction behaviour, the new step limit, mobile behaviour, feedback changes, and test results.
