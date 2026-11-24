# NTAK PMS v9 — Phase 11: rehearsal and certification runbook

**Scope:** documentation only. No executable changes, migration application, deployment, authority switch or actual submission is authorized by merging this document. Owner approves dates and signs; Claude prepares and verifies the dedicated test property and assists the operator. Status: NOT RUN.

## Authoritative inputs

- NTAK PMS Interfész Validációs Tesztfeladatok és jegyzőkönyv v1.07 (2026-09-24), especially introduction, sections 1–6.
- Szobatükör_segédlet_v1.07.xlsx, including the full T03_FOGL_2_terhelés worksheet. Obtain the exact workbook from the owner before executing; do not reconstruct missing values from this summary.
- Use the official interface annex for category and IFA codes and the supplied test endpoint configuration. Where this checklist disagrees with the authority package, stop and resolve the discrepancy before sending.

## 1. Go/no-go (Claude verifies; owner approves)

- [ ] All phases 1–10 merged, tested and deployed to the intended isolated test environment; verify actual schema, function versions, UI build and commit SHA, not merely PR status.
- [ ] Dedicated test property (verify canonical hotel ID and organization; Phase 1 seed targeted channex-test-property) has only scoped rooms 101–104 and official capacities (4 rooms / 10 beds on normal days); verify no real property or guest data enters the run.
- [ ] Correct NTAK TEST environment, registration/software ID, header names, valid test certificate, trusted TLS, transport connectivity, authorized manager/admin, and test-only historical business moments in Europe/Budapest. Never use production credentials or disable TLS verification. No private key in evidence.
- [ ] Confirm room-state history, guest-level transitions/undo and room changes, day use, historical postings, walk-in sale and ledger balance, booking ID/fields, IFA codes and corrections, all catalogue and seven payment mappings, rejection/retry workflow, evidence ZIP and permission checks.
- [ ] Verify ordinary business actions cause automatic message generation and sending without manual intervention (except section 4 error simulations). Confirm worker timing and queue handling. Do not manually craft XML or force-send routine cases to achieve a pass.
- [ ] Confirm date history and existing closure/message ledger before reserving dates. Disable or isolate unrelated automation that could send for the chosen test dates; never disable required normal reporting path or modify real hotel switches. If isolation cannot be proven, stop.
- [ ] Have v1.07 task sheet and workbook open, full-screen screenshot capture ready, encrypted/access-controlled evidence location, and named owner/Claude operator. Record exact version, test configuration identity (no secrets), run ID and date plan.

- [ ] Claude alone sets and verifies `ntak_settings.first_closure_date` on `channex-test-property` to T01 or earlier, and the historical minimum date to T01 or earlier, after owner approval. A missing first closure date or a later date blocks the historical sequence. Use the authorized NTAK settings UI or Claude's reviewed database process; read back the dates before activating. Never change another hotel's dates.
- [ ] Only `channex-test-property` may be activated after readiness approval. `ntak-v9-validation` shares the registration and reporting ID and must remain disabled throughout. Never activate either from this checklist.
- [ ] Obtain the authority's written confirmation that trial sends are allowed on this exact test registration. Until owner confirms receipt, the rehearsal dates remain TBD and no trial messages may be sent.

- [ ] VIZA is currently enabled on `channex-test-property`. Recommended: Claude/owner temporarily disables VIZA there for the NTAK-only run and verifies the queue is isolated before any historical arrivals. Otherwise all test guests need complete document data AND a verified isolation mechanism preventing historical NTAK arrivals reaching the VIZA test server. Do not change other properties, drain unrelated queues, or enable either service from this runbook. Restore the approved VIZA test configuration only after NTAK isolation is verified.

## 2. Date plan — separate rehearsal and official validation

The official v1.07 introduction specifies nine subject days and eight distinct daily closing dates; T01–T05 are five consecutive days with no omissions and may be historical. TX is no earlier than the actual current calendar date when advance bookings are generated. TY is a separate, previously unsent date and need not adjoin T01–T05. Use Budapest calendar dates; do not fake the current date or shorten the elapsed run. The official validation window is at most five calendar days; plan three consecutive actual days A/B/C.

| Field | Rehearsal | Official |
| --- | --- | --- |
| Run ID | TBD | TBD |
| T01, T02, T03, T04, T05 | TBD (five consecutive past days) | TBD (different five consecutive past days) |
| TX = actual Day A | TBD | TBD (different, future at planning) |
| Day B = TX+1 | TBD | TBD |
| Day C = TX+2 | TBD | TBD |
| TY | TBD (unused eligible day) | TBD (different unused eligible day) |
| Owner approval / test property / build | TBD | TBD |

Use nonoverlapping subject days across the runs (including TX, TX+1, TX+2 and TY); choose T05 before TX and TY already eligible for closing on Day A. Check all eight closure dates are unused for a new closure at the authority, not merely absent locally; use available reporting history and coordinate with NTAK if uncertain. Only if NTAK explicitly permits trial sends for this registration, a rehearsal is a full three-day test-endpoint run with its own different five-day historical period and TY. Trial sends may consume a subject day; do not reset or delete local logs to reuse it as new. No dates reserved or transmissions performed by this document.

## 3. Execution order

For each row, record actual message ID(s), event/closing time(s), processing ID(s), exact signed request, response, result-query request and response, final result and full-screen UI screenshots. Wait for and inspect the processing result before advancing a dependent step; record all attempts. A transport success alone is not a pass. Use the exact workbook data and official fixture dates for all unspecified fields.

### Day A — TX (historical cases first)

| Done | Case | Business day | Operator action and expected checkpoint |
| --- | --- | --- | --- |
| [ ] | NZ_01 | T01 | Mark property closed; new closed-day closing, successful. |
| [ ] | ES_01A | T02 | FOGL_01 room 101: arrive Luca Ferri, Zsidi Mária and Zsidi Tibor. |
| [ ] | ES_01B | T02 | FOGL_02 room 102: arrive Natasha Chenkova. |
| [ ] | ES_02 | T02 | Undo mistaken arrival of Zsidi Tibor only; other guests remain. |
| [ ] | NZ_02 | T02 | Room 103 OOO, 104 OOS; 3 guest nights, 2 rented units, IFA 400 HUF. Walk-in spa 5800 (18%), main course 4600 (5%), other catering 1000 (27%), alcoholic package 10000 (27%); card 21400. Check guest/unit data and OOO/OOS reporting. |
| [ ] | ES_03 | T03 | FOGL_02 move from room 102 to 103; preserve historical occupancy. |
| [ ] | NZ_03 | T03 | 3 guest nights, 2 rented units, IFA 400 HUF. Post exact worksheet categories and amounts; payments cash/card/transfer/voucher/SZÉP accommodation 4067 each, deferred/other 4066 each (28467 HUF total). |
| [ ] | ES_01C | T04 | Arrive Sergey Cherkasov, FOGL_02 room 103. |
| [ ] | ES_04A | T04 | Depart Luca Ferri and Zsidi Mária, FOGL_01 room 101. |
| [ ] | ES_04B | T04 | Depart Natasha Chenkova, FOGL_02 room 103. |
| [ ] | ES_05 | T04 | Undo Natasha's mistaken departure; retain other guest states. |
| [ ] | NZ_04A | T04 | New closing: 2 guest nights, 1 rented unit, IFA 400 HUF; Sergey taxable, birth 1986-01-01. |
| [ ] | NZ_04B | T04 | Correct Sergey birth 1987-02-11 and exempt (authority/court measure; official annex code). Modified closing VENDEG_VAGY_IFA_JAVITAS, same 2 guest nights / 1 unit, reconcile IFA and ledger. |
| [ ] | ES_06A arrival | T05 | FOGL_03 day-use Nagy Klára, room 103. |
| [ ] | ES_06A departure | T05 | Same-day departure, room 103. |
| [ ] | ES_06B arrival | T05 | FOGL_03 day-use Kovács Bianka, room 104. |
| [ ] | ES_06B departure | T05 | Same-day departure, room 104. |
| [ ] | NZ_05 | T05 | Zero guest nights; room 103 accommodation 28000 cash, room 104 accommodation 34500 card; manager posts the post-stay FOGL_01 other charge and card payment 10000 each; IFA 400 HUF setting. |
| [ ] | ELO_01A | TX | Create FOGL_04, room 101, HU booker, TX+1 to TX+2, direct online, individual business, guaranteed, 20000 HUF, 1 expected guest. |
| [ ] | ELO_01B | TX | Create FOGL_05 separately, room 103, other foreign booker, TX+1 to TX+2, traditional intermediary, group business, not guaranteed, 28000 HUF, 2 expected guests. |
| [ ] | ELO_02 | TX | Modify FOGL_04 arrival to TX, non-guaranteed, 40000 HUF; verify separate message before check-in. |
| [ ] | ELO_03 | TX | Cancel FOGL_05; verify cancellation message. |
| [ ] | FOGL_04 arrival (support) | TX | Check in Fekete Péter using official workbook; retain any generated event evidence. |
| [ ] | EU_03A | TY | New closure, IFA 400 HUF, only booking ID __UJRAKULDENDO_VALIDACIO__, no other bookings or charge lines; verify resend-required status and screenshot before resend. |
| [ ] | EU_03B | TY | Resend unchanged business payload as new closing, not modifying; verify TELJESEN_SIKERES and capture both attempts and IDs. Do not invent required envelope/id behavior; use implemented protocol. |
| [ ] | AD_01 | TX | Call reporting expected-date query then query its processing result; retain four XMLs and screenshot. |

### Day B — TX+1

| Done | Case | Business day | Operator action and expected checkpoint |
| --- | --- | --- | --- |
| [ ] | Tibor Benedek arrival (support) | TX+1 | Check in using workbook; retain generated event evidence and ensure the TX closing excludes this next-day arrival. |
| [ ] | EU_01A | TX | New closure, IFA 400 HUF, FOGL_04 breakfast 3000000 HUF. Use audited test override; expect fully erroneous/rejected status; screenshot error before repair. |
| [ ] | EU_01B | TX | Correct breakfast to 3000 HUF; send NEW closing (not modifying), IFA 400 HUF; verify success, retain original and correction evidence. |

### Day C — TX+2

| Done | Case | Business day | Operator action and expected checkpoint |
| --- | --- | --- | --- |
| [ ] | EU_02A | TX+1 | New closure: IFA 5%, 12 beds, 5 rooms, champagne 200001 HUF, booking IFA 3000 HUF, Tibor Benedek postcode 1116101; expect examined status; screenshot and retain audit reason. |
| [ ] | EU_02B | TX+1 | MODIFIED closure TECH_HIBA_ADATJAVITAS: IFA 400 HUF, 10 beds, 4 rooms, champagne 2000 HUF, booking IFA 400 HUF, postcode 1116. Verify success. |
| [ ] | Evidence and owner review | All | Export, reconcile and complete official sheet; owner signs and submits separately only after passing official run. Rehearsal is never submitted as certification. |

## 4. Evidence and acceptance

- Create a distinct access-controlled folder per run; use Phase 10 Messages date/kind filters, individual copy/download and ZIP. Include TY even if outside other date ranges; filter by both event/subject dates and actual send dates where supported, cross-check message IDs.
- For each case/attempt preserve exact sent signed XML, authority response XML, verification request XML, verification response XML, uzenet_id, event or closure time, sent_at, processing_id, final status; record linked retry/correction IDs and full-screen UI evidence (before/after for corrections). Keep interim polls and any failures, never fabricate missing responses or overwrite previous attempts.
- Expected minimum official labeled evidence sets: 4 advance booking, 12 event (ES_06A/B each arrival and departure), 6 NZ, 6 EU, 1 AD = 29 sets, plus supporting arrivals and any actual additional attempts. Eight unique daily closure dates; twelve labeled daily closing submissions including corrections and resends. Four XMLs per labeled set = 116 expected XML slots; preserve additional messages/polls and explain any missing fields.
- Reconcile each worksheet entry to actual messages: correct hotel, case, day, guest/booking IDs, amounts/categories/VAT/payment method, IFA, closure type and reason, authority status. Do not mark a case passed without its required result and evidence.
- Use full-screen UI images in NTAK document, populate cover sheet including company/PMS/version, test window, T01/TX/TY, registration/software ID and contact; fill all case values and four XML sections, note deviations honestly. Owner checks section 6 automation declaration and selects exactly one error-handling declaration (list unsupported errors where applicable), dates/signs and sends only the official completed package through agreed authority channel.
- No private keys, access tokens, real guest records or raw evidence in GitHub. Keep original authority XML securely; redact only separate sharing copies where permitted, never falsify authority submission.

## 5. Separate VIZA validation

VIZA ticket 150445 uses its own worksheet and evidence package, not the NTAK day plan. Cases 2.1 and 2.2 are performed on the central THF; cases 2.3 and 2.4 use the own THF and remain blocked until the TLS gateway is ready and trusted. Keep both tests separate; do not submit VIZA or NTAK messages as part of code review. Verify mandatory guest data server-side before any arrival; a failed reader means manual entry, not a bypass.

## 6. Failure and handoff

If unexpected result, missing evidence, duplicate closure, wrong property/endpoint, pending dependency, or unresolved workbook discrepancy: stop dependent cases; preserve all attempts and record the blocker, owner, fix PR and rerun scope. Do not reset authority history, reuse a consumed day as new, or manually edit XML to force a pass. Rehearsal failures must be resolved and verified before official dates are approved. If the official window cannot be completed, coordinate a new date plan with NTAK.

Run record (repeat per attempt): case | subject day | actual timestamp | operator | booking/room | message ID | processing ID | expected / actual status | four XML paths | screenshot paths | deviation | pass/fail.

Owner sign-off: rehearsal PASS / FAIL / NOT RUN; official dates approved Y/N; all blockers closed Y/N; official execution PASS / FAIL / NOT RUN; package checked Y/N; signed and submitted Y/N. Default: NOT RUN, no approval and no submission. Merging this runbook is not NTAK certification.
