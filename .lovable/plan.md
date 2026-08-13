# Prices that read as "sent", not "stuck in draft"

## What happens today

When you publish a price range, the rows stay in the pending table as `pushed` while Previo's read-back is still open. The calendar treats every pending row the same way as a genuinely unsent draft:

- the cell gets the dotted underline, whose legend says "publishing issue"
- the cell tooltip says "Not sent to Previo yet"

So a price that was accepted seconds ago looks like a failure. The push itself is fine — only the wording and the marker are wrong.

## What will change

### 1. Three honest cell states instead of one

| State | Cell looks like | Wording |
| --- | --- | --- |
| Waiting to be sent (real draft) or refused | dotted underline | "Waiting to be sent to Previo" / "Did not reach Previo" |
| Sending / awaiting Previo's read-back | normal price, small hollow pulsing dot in the corner | "Sending to Previo now — this price is already applied here" |
| Confirmed | normal price, solid colour dot | existing wording (team / automation / Previo) |

The dotted underline is reserved for prices that really have not left the app. The new price is always the number shown in the cell, in every state.

### 2. The dot turns your colour immediately

On publish, the grid records the change locally (same place as the optimistic price mirror) so the blue "changed by your team" dot appears the moment you confirm, instead of after the audit trail reloads. When Previo confirms, the local marker is replaced by the real audit entry — same colour, so nothing visibly flips. If a price genuinely diverges, it turns red as it does today.

### 3. Wording everywhere matches

The cell hover card, the mobile tap sheet, the cell history panel and the legend all use the same three states. The legend's "publishing issue" item becomes:

- dotted underline — not sent yet
- hollow pulsing dot — sending now

### 4. Status stays small

The existing top pill and small corner marker are kept as-is; no new banner, no blocking dialog. The pill keeps its "sending / live in Previo" copy and self-clears.

## Technical notes

All work is in `src/components/revenue/RateStrategyGrid.tsx`, plus small additions to `src/lib/rateOrigin.ts` and `src/components/revenue/RateCellHistory.tsx`:

- `refreshDrafts` already loads pending rows; split its `drafts` map into `unsentByCell` (`status` in `draft`/`failed`) and `inFlightByCell` (`status = pushed` with `confirmation_status` in `sending`/`sent`/`checking`/`pending`). Cell price = unsent ?? in-flight ?? published (optimistic mirror unchanged).
- Dotted-underline class keyed off `unsentByCell` only; in-flight cells render the hollow pulsing marker.
- `originLabel` rewritten to branch on unsent / failed / in-flight / confirmed.
- Add an `optimisticOrigin` map (cell key → `{ origin: "team", at }`) set in `publishInBackground`, merged into `cellOriginEvents` results and cleared once the audit row for that cell arrives.
- No database, edge function or push-logic changes.
