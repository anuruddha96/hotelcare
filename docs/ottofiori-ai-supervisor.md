# Ottofiori AI supervision — 6 November 2026

Ottofiori has two coordinated decision layers. The frequent deterministic engine reacts to bookings and quiet periods. An independent OpenAI review evaluates the sales situation and can publish its own bounded price decisions, even when the normal engine is holding. Both use the existing complete 13-cell date-column publisher.

## Incident and commercial changes

The rules engine could consume small daily allowances early and then hold otherwise weak dates. Conflicting hotel and reference floors could also let one low guest-count price freeze an entire date column. The new supervisor makes independent, bounded decisions while retaining the existing atomic publication contract.

The explicit Ottofiori lockstep floor is now €80 per cell, retaining the €500 safety ceiling. The new daily downward limits are €24 for D0–3, €18 for D4–7 and €12 for D8–120; six reductions per local day maximum. Quiet windows remain 2/3/4/6 hours, with 2/3/4/4-hour spacing. Directional allowances and the hotel movement budget are shared across AI and engine decisions; proposals, rejected moves and shadow runs do not consume them. The 25% campaign-depth protection remains. Other properties' pricing policy is unchanged.

The normal engine can test €1 lower on a quiet final room in the next four days after at least four hours without pickup. Genuine recent demand and verified events remain protected. Monthly ADR objectives are portfolio goals, not mandatory floors on every empty date.

## API review and coordination

`ottofiori-ai-supervisor` authenticates a private Vault worker secret or the server's service key. It claims the same global automation lease as the existing engine, confirms a full authoritative Previo reservation/rate refresh and evaluates up to 56 sellable date columns. The next four days come first, followed by weak November/January dates. Inputs contain aggregated hotel data and price cells, without guest names or contact details.

The model receives current occupancy, remaining inventory, 1/6/24/48-hour and seven-day pickup, cancellations, lead-time pace, actual directional allowance, recent changes, manual protection, comparable-market quality, event evidence and available last-year history. Missing history is unknown. Old engine hold labels do not override the current allowance.

Model selection checks the actual API key's available models. GPT-6.1 Sol is preferred when available, with GPT-5.6 Sol and compatible fallback models selected from the actual model inventory; Astra escalation is only considered when available, close-in conversion has remained weak across prior reviews and no Astra review ran in the preceding 24 hours. There is no assumption that a ChatGPT subscription itself supplies production API access. Calls use the existing server-side `OPENAI_API_KEY`.

One complete structured decision is required for every supplied date. The request uses bounded input/output, low reasoning for routine analysis, no paid web tools, no guest data and `store:false`. Model entitlement failures allow one compatible fallback; quota/billing errors do not start a retry loop. Estimated provider usage is recorded in `ai_usage_log`. The supervisor adds its own $1.50/day and $30/month limits inside the organization's existing budget. Cost accounting uses provider token usage and model pricing; estimates are not invoices.

The private cron runs at `11 */4 * * *` UTC. A unique four-hour slot and a minimum four-hour interval after a completed review prevent duplicate paid work, including manual launches near a schedule boundary. ChatGPT's existing Ottofiori task now checks the worker and publication outcomes every four hours rather than acting as another competing price writer.

`ottofiori_ai_apply` rechecks a fresh, complete 13-cell baseline, occupancy, manager protections, pending publications, current daily budgets, campaign depth and pickup before calling the existing atomic bridge. Dry run and commit use identical requests. A changed baseline aborts the move. AI rises consume eligible booking tokens once and use the same measured single-booking limit as the final publisher. The old bridge cannot be called independently of a current reviewed application.

Applied decisions create a policy with up to four hours of observation priority. The normal engine records an AI observation hold instead of counter-trading. A new genuine booking releases that observation so the fast engine can react. Hard manager locks and current human-edit protection remain authoritative. A recent human price change is therefore observed instead of immediately overwritten.

An event's existence is distinct from compression at Ottofiori. The API may test only €1–2 lower on an event date when occupancy is below 70%, at least five rooms remain, six-hour pickup is zero and the date has been quiet for at least 24 hours (or remains entirely empty). The normal engine keeps its event protection; the superior AI layer can make this explicitly bounded commercial exception.

## Competitors and restrictions

The old daily scan covered 60 consecutive dates, ending before most of January. The revised plan still requests at most 60 dates, distributed through D+120, prioritizing the next fortnight and full November/January dates. Sparse remaining dates rotate. Targeted refreshes accept explicit validated dates without requesting another full scan; their spending still counts against the organization budget. Slow source requests could outlive a worker and leave stale running records. The scanner now dispatches one runtime per competitor, caps a source request at 35 seconds, caps each worker at 90 seconds, does not retry provider timeouts, and preserves explicit partial-coverage errors. Results are limited to actually requested dates and counts use unique newly observed dates.

A precise undercut needs at least three fresh comparable properties. A partial scan is never described as full market coverage. Current PMS gross prices and competitor public quotes are not automatically equivalent after breakfast, cancellation terms, taxes or channel discounts. Unknown OTA checkout prices remain unknown.

AI reports non-price barriers without claiming that it has changed promotions, inventory or OTA configuration. Check live restrictions and channel settings separately before treating low pickup as exclusively a price problem.

## Validation and operational checks

Validation includes 81 Node regressions, 22 original Deno engine tests, a TypeScript check of the new worker, a rolled-back database rehearsal of the actual atomic preview and stale-baseline/per-step rejection, authenticated live execution, unauthenticated HTTP rejection and the independent PMS readback. The standard Deno assertion modules were cached unchanged because direct Deno downloads were blocked in the workspace. New tables have RLS and server-only grants; policy foreign keys are indexed.

`ottofiori_ai_review_runs` retains model/cost, all decisions, rejected reasons and queued/observed outcomes. Successful readback adds per-date checked/matched counts and timestamps. `revenue_ai_insights` and the activity feed expose the AI summary. Routine zero-change notifications are suppressed for scheduled Ottofiori engine runs; full decisions remain in the ledger and failures remain visible.

For an authorized check, call `public.invoke_ottofiori_ai_supervisor()` and inspect the persisted review. HTTP `started:true` is only acknowledgement. Never reset review slots to force paid work, fabricate a decision/draft, or bypass a rejected preview. Check every push run and fresh PMS values before describing changes as verified.
