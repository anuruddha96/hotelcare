# RD Hotels Excel roster sync — pilot UAT / release blocker

**Draft code only; do not merge, deploy, run migrations against production, or upload the real roster to GitHub.** See PR #229 and issue #228. User-provided `WORK SCHEDULE 2026.xlsx` was inspected locally for structural patterns only. No employee names, usernames, account IDs or workbook bytes were checked into the repository.

## Actual source-file structures verified, 2026-09-17

- Monthly tabs have Hungarian month names and explicit years (`Szeptember 2026`, `Október 2026`, etc.) alongside undated `minta` template. Tabs share columns across multiple hotels, finance/HR and restaurant departments.
- Row 1 contains a department/venue label per column, row 2 an employee display name, column A a numeric day, column B a weekday. Blank weekly separators are common.
- Most month tabs append next-month days after the final day (e.g. September ends at 30, then shows October 1–4). Those trailing rows MUST NOT be assigned to September or double-imported when October's own tab is selected.
- Excel stores some human-entered `08-17`, `11-20`, etc. as numeric **date serials** with custom `mm-dd` or `m-d` format. Never interpret arbitrary numbers as shifts. The parser currently recognizes *only* verified `mm-dd` formatting after the manager checks an explicit consent box. `m-d`, numeric non-date cells, or other date formats still block until specifically reviewed or corrected; no general date serial-to-shift heuristic.
- Other cells contain opaque codes such as `SZ`, `K`, `HK`, `SV`, `mika`, and combined duty/location texts; the meaning varies by department, so no global interpretation is safe. Unknown tokens need a manager-approved explicit work-time or non-working code rule. Clearly formatted split shifts and explicit `(+1)` overnight shifts are supported.
- Historic tabs may contain formulas in total/footer cells. Formula cells in a selected employee's actual day/shift slot block import, but harmless formulas on unselected sheets must not prevent employee alias mapping.

## Step-by-step approved test flow

1. Apply the three RD-only migrations (`160000` foundation, `163000` alias links, `170000` atomic import) ONLY to an approved test database after an independent SQL security review. Use synthetic copies, never real personal/health data in tests.
2. As an RD manager scoped to ONE venue, open Work Schedule. Attempt other venue via browser selection and forged REST/RPC: reject. As HR/admin, explicitly select the authorized venue, not a filename-dependent hotel.
3. Upload a synthetic copy with 2–3 dated Hungarian tabs, mixed Gozsdu/Mika/Memories/Ottofiori headers and undated template. In section 1, confirm aliases to existing authorized `profiles.id` accounts; do not create accounts. Reload saved links in section 2. The cross-venue account/header must be excluded or rejected.
4. Choose two monthly tabs, including a tab with next-month trailing days. Assert only valid days of the named month are included and template is ignored. Check that selecting no tabs or an empty/malformed date sequence blocks import.
5. Check unknown tokens, duplicate aliases, missing account links, other-hotel headers, unexpected numeric cells, active-slot formulas and ambiguous overnight shifts all BLOCK. Only an explicitly reviewed codebook can resolve opaque tokens; only the explicit mm-dd checkbox can resolve recognized Excel autoformatted shifts.
6. Compare against test database. Verify new rows versus changed drafts versus unchanged rows versus conflicting published rows. Published *differences* block the entire import. Existing published *identical* rows remain untouched. Absences never mean deletion, and original operational notes remain unchanged.
7. Approve the diff and call the scoped atomic import as the real test manager JWT (never a service-role key). Verify audit events, run counters, row versions, source `xlsx` and draft-only state. Staff MUST NOT see drafts. After separate approved publication, staff can see their OWN published roster via `profiles.id` only.
8. Re-import the identical file: expect zero new/changed, all unchanged. Between comparison and import, change a draft in another authorized session: the optimistic version check MUST abort and roll back the **whole** request. Try a duplicate row, unconfirmed alias, cross-venue profile, unauthenticated user, staff user, other org user, and tampered `hotel_id`/date: expect rejection with zero new rows.
9. Verify >1000 existing rows are retrieved via paging, 6001 selected entries are blocked, and 15001 pre-existing rows cannot be silently truncated. Do not assume a frontend `vite build` proves the SQL function, RLS, or behavior above.
10. Check desktop/mobile, accessibility, Hungarian/English UI, night-shift and DST rules with HR; §97 roster notice, rest/break law, GDPR retention and data processing must be approved before any production deployment. Imported drafts must never send employee notifications as if already published.

## Known gaps / explicit product decisions

- The first-phase mapping and sync are two sections with separate local file selectors: after saving a new alias, reload links in section 2 and select the same workbook again. This protects privacy but is not the eventual one-upload experience.
- The new importer does NOT delete missing rows, automatically change published shifts, compute actual/paid hours or holiday balances, create login accounts or allow unreviewed codes. It imports a maximum of 6000 selected shift rows in one **all-or-nothing** venue transaction; larger workbooks must be scoped by months/venues. There is no admin undo for a *successful* batch yet; before go-live implement an audited revision/undo policy.
- Direct SQL migrations were NOT executed in production. GitHub frontend CI tests are synthetic only; independent authenticated test-DB security probes and real workbook UAT remain mandatory before a merge.
