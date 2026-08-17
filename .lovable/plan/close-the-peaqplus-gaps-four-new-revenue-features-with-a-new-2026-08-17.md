# Close the Peaqplus gaps — four new revenue features with a "New" badge

The article about Peaqplus (Rate Republic, 46 hotels) names the functions their revenue expert
uses most: **insights**, a **yearly overview with comparison**, a **competitor rate watch**, an
**automatic morning e-mail**, **segment-level (not single-segment) data on the whole property**,
and **owner/director-ready reports**. Compared with what Hotel Care already does, four of these
are genuinely missing.

## What we already have (no work needed)

- Insights / AI analysis, pickup and occupancy horizon, demand events, automation — covered by the
  existing Revenue page, analyst panel and pickup engine.
- A 12-month mini calendar and an Excel/CSV export exist, but neither compares against last year
  and the export is a raw data dump, not a management report.

## The four gaps to build

### 1. Segment & channel performance (whole property, not one segment)
A new tool in the Revenue tools bar showing, for the selected month and hotel: rooms, room nights,
revenue, ADR and share per booking channel/segment (Booking.com, Expedia, direct, corporate,
walk-in…), with the pickup that came from each in the last 1/7/30 days. Built from reservation
data already synced from Previo — no new PMS calls.

### 2. Year-over-year overview
A yearly view that puts this year next to the same period last year: occupancy, ADR, RevPAR and
revenue per month, with the variance shown as a percentage and a colour. Same 12-month layout as
today's calendar, with a "vs last year" toggle. Where last-year data is missing the cell says so
instead of showing a false zero.

### 3. Competitor rate watch
A per-hotel list of competitor properties (name + a public rate source). A scheduled job reads
their published rate for the next 30–60 days and stores it, so the Rate & pickup calendar can show
"you are 12% above the set" on a date, and a panel shows the comparison over time. Hotel Care goes
one step further than the competitor here: a rate that sits far off the set feeds the existing
automation as an extra signal, and the assistant can be asked about it.

### 4. Automatic morning e-mail
A daily 06:30 Budapest e-mail per hotel to managers and top management: yesterday's pickup, today's
arrivals/occupancy, the next 14 days that need attention, what the automation changed overnight,
and any date that is far off the competitor set. Recipients and send time are configurable per
hotel, and each person can switch it off in their notification preferences.

## The "New" badge

A small reusable badge marks each newly released feature:

- It shows for **5 days from the release date**, or until **that user opens the feature** —
  whichever comes first. Opening it once hides it for that person on every device.
- It appears on the tool button/tab and, when the feature lives inside a page, on that page's menu
  entry, so the user can find it.
- Only the four features above are marked now; the same badge is reusable for future releases.

## Technical notes

- New tables: `revenue_segment_daily` (rolled up per hotel/date/channel), `competitor_properties`
  and `competitor_rates`, `revenue_digest_settings`. All with GRANTs and RLS scoped by
  `organization_slug` + `assigned_hotel`, revenue roles only (admin / top_management / manager).
- Year-over-year reads the existing `revenue_daily`-style history; no new table.
- New edge functions: `revenue-segment-rollup` (runs after each Previo sync),
  `competitor-rate-scan` (nightly, uses the existing OpenAI key + web fetch for public rates),
  `revenue-morning-digest` (pg_cron 06:30 Europe/Budapest, sends via the existing Resend setup).
- Frontend: `SegmentPerformancePanel.tsx`, `YearOverYearPanel.tsx`, `CompetitorRatePanel.tsx`,
  `DigestSettings` inside revenue settings, all opened from `RevenueToolsBar`.
- Badge: `feature_releases` constant (key + release date) plus a `NewFeatureBadge` component that
  marks a key as seen in `profiles.ui_preferences` through the existing `useUiPreference` hook.
- Access follows the existing role rules; reception and housekeeping never see these tools.

## Not in this phase

No automated rate change from competitor data (it is a signal, not an action) and no e-mail
digest for departments other than revenue.
