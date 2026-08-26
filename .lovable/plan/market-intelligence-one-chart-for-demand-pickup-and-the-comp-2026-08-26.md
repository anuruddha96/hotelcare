# Market Intelligence: one chart for demand, pickup and the competitive set

Today the revenue page has two disconnected views: the "Demand & pickup horizon" card (own pickup, occupancy, ADR, in-house demand index, sister-hotel occupancy lines) and a separate "Competitor rates" drawer with its own small chart. The plan merges them into a single market intelligence surface, and makes the competitor scrape materially more accurate and self-maintaining.

## 1. Rename and reposition the chart

"Demand & pickup horizon" becomes **"Market intelligence horizon"** with the subtitle "Pickup, demand and the competitive set, night by night". It stays in the same place on the revenue page, directly under the rate calendar.

## 2. Merged, fully tickable series

A single compact "Series" control replaces today's scattered toggles. Everything is a checkbox, remembered per user (localStorage, per hotel):

```text
Ours            [x] Net pickup   [x] Occupancy   [ ] Our ADR
Market          [x] Market average rate   [ ] Market median   [ ] Demand index
Competitors     [ ] Bohem Art  [ ] Hotel Vision  [ ] Zenit Palace  [ ] La Prima  ...
Our other hotels[ ] Mika Downtown  [ ] Memories  [ ] Gozsdu Court  ...
```

- Competitor and sister-hotel rows show a colour swatch, the last-checked time and the price count, so a hotel with thin data is obvious before it is plotted.
- Rate series (ours, competitors, sister ADR, market average) share the right-hand money axis; pickup, occupancy and the demand index keep the percentage/count axes.
- **Compare any hotel against the market**: a "Baseline" selector at the top of the chart switches which property the bars/lines and the "vs market" delta are computed for — own hotel by default, any sister property otherwise. The header then reads e.g. "Ottofiori is 12% above the market average over the next 30 nights".
- Tooltip becomes a per-night market table: our rate, market average/median, cheapest and dearest in the set, our rank (e.g. "3rd of 7"), pickup and occupancy.
- Ranges (14/30/60/90/180d) and pickup-window presets stay as they are; competitor data simply draws where it exists and breaks the line where it does not (never interpolated).

The Competitor rates drawer stays, but becomes **compset management only**: add/remove hotels, AI discovery, scan-now, per-hotel scan health. All comparison charting lives in the merged chart.

## 3. More precise competitor data

Current scan asks a generic question and stores one price per hotel per night. Improvements:

- **Qualified rates**: each stored row records room type, occupancy (2 adults), board (room only / breakfast), refundability, the exact source page and the currency it was quoted in, plus an FX-normalised value. Comparing a non-refundable room-only rate against our flexible-with-breakfast rate is the main source of misleading gaps today.
- **Confidence and provenance**: every price carries a confidence score and the URL it was read from; low-confidence values are dimmed in the chart and excluded from the market average.
- **Outlier-resistant market average**: trimmed mean (drop highest and lowest when 4+ hotels reported) plus a median line, instead of today's plain mean over whatever was found.
- **Freshness rules**: a price older than 48 hours is marked stale, drawn faded, and excluded from the headline "vs market" number.
- **Per-competitor scan runs** are recorded (dates covered, prices found, failure reason, model/tokens) so a hotel that keeps returning nothing — like Bohem Art in the screenshot — can be diagnosed and auto-deactivated after repeated empty scans, with a prompt to fix its rate page URL.
- **Coverage widening**: chunked date queries (already in place) plus a second pass that only re-asks the dates a competitor left blank, so partial results fill in over consecutive days rather than staying at "0 prices".

## 4. Daily automatic scraping on your own OpenAI key

- The existing daily cron (05:25 Budapest) stays and is extended to a **twice-daily sweep** (early morning + early evening) so evening rate moves are captured before the next morning's decisions.
- Every hotel with active competitors is swept; the run is bounded (max competitors and date chunks per invocation), single-flighted with a lease row so overlapping crons cannot double-spend, and idempotent per competitor+date.
- Circuit breaker: repeated OpenAI auth/credit/rate-limit failures pause the sweep and surface a banner in the compset drawer instead of burning key quota silently.
- Continues to use the project's own `OPENAI_API_KEY` with web search; no change to where the key lives.

## 5. Surprise-and-delight layer

- **Rate position band** drawn behind the chart: shaded area between the cheapest and dearest competitor for each night, so our line visibly sits inside or outside the market.
- **Market gap alerts**: nights where we are more than a configurable % below or above the set get a marker and appear in the morning digest ("3 nights priced 18% under the market with rooms left").
- **Compression signal**: when the market average rises sharply while our occupancy is still low, the night is flagged as an underpricing opportunity; the flag feeds the existing recommendation/notification surface.
- Export of the merged view (dates, our rate, market average, each competitor) to CSV for owner reporting.

## Technical notes

- `competitor_rates`: add `room_type`, `occupancy`, `board`, `refundable`, `source_page_url`, `confidence`, `rate_original`, `currency_original`; keep the `(competitor_id, stay_date)` upsert key extended with the rate qualifiers.
- New `competitor_scan_runs` table (hotel, competitor, window, prices found, error, started/finished) plus a lease row for single-flight sweeps.
- `competitor-rate-scan` edge function: qualified prompt + strict JSON schema, blank-date second pass, per-run recording, bounded work, circuit breaker on 401/402/429.
- New `market_rates_by_date` RPC returning trimmed mean, median, min, max, sample size and freshness per stay date — one call feeds both the chart and the digest.
- `PickupHorizonChart.tsx` renamed to `MarketIntelligenceChart.tsx`, gains the series registry, baseline selector and competitor/market series; `CompetitorRatePanel.tsx` loses its chart and keeps management + scan health.
- Everything stays scoped by `hotel_id` and `organization_slug`; other organisations are untouched.
