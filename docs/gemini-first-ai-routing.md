# HotelCare Gemini-first low-cost AI rollout

## Goal
Reduce OpenAI costs on small text tasks using the server-side `GEMINI_API_KEY` first.
OpenAI remains the automatic fallback for provider errors, invalid content and quota
exhaustion, bounded to 20 fallback calls per Edge Function isolate per hour by default.
The per-isolate limit is **not** an organization-wide spend cap.

## Scope
- `google-reputation`: public Google review drafts use Gemini first; curated
  positive-review replies remain free and are unchanged. Three-alternative manager
  customizations use Gemini first for ordinary tone/style instructions. The reviewer's
  display name is removed from the Gemini prompt; suspected personal/confidential
  content and confirmed sensitive incidents stay on OpenAI.
- `google-reputation-worker`: scheduled public review drafts use Gemini first.
  Existing automated-publishing risk checks are not modified.
- `translate-room-types`: cached, non-confidential room-type names use Gemini first.
- `translate-note`: ordinary non-sensitive housekeeping/maintenance notes use Gemini
  first with OpenAI fallback. Potentially identifiable guest/staff details (including
  room-number-plus-context, contact information, health or payroll) stay on OpenAI.

Revenue and AI extensions (17 November 2026):
- Ottofiori's four-hour AI supervisor attempts Gemini first with strict JSON and
  complete per-date business validation. An invalid/incomplete Gemini answer or
  Gemini provider error can fall back to OpenAI. The same 13-cell Previo atomic
  publisher, occupancy protections, manual locks, and budget ceilings apply.
- Revenue intelligence, booking-event research, public competitor discovery and
  market scans attempt Gemini first. Google Search grounding must exist for
  Gemini-backed public-source claims; missing verification falls back to OpenAI
  or remains unverified. Do not treat AI price quotes as confirmed without
  public-source and existing PMS validation.
- Mira's tool-using chat, premium analysis, title generator, and public web search
  use Gemini-first models with OpenAI fallback. A provider may be retried only
  before user-visible streaming starts; never splice a second provider mid-answer.
- Voice transcription and invoice OCR are eligible for Gemini only when paid
  confidential-data processing is explicitly approved. Unsupported documents
  revert to OpenAI when available. Existing validation is unchanged.
- Quote generation, revenue recommendations, event sweeps and housekeeping
  assignment analysis route Gemini-first, subject to privacy restrictions.

**Privacy gate:** Gemini Developer API unpaid processing may allow content
improvement/human review. Set `GEMINI_PAID_DATA_PROCESSING_CONFIRMED=true`
ONLY after checking the API account is on an approved paid data-processing
arrangement with adequate GDPR protections; otherwise staff, guest, invoice
and conversation data remain on OpenAI. This is an intentional exception to
the general Gemini-first rule; never bypass the gate by changing the task type.

**Verification:** a stored `GEMINI_API_KEY` does not guarantee actual success.
Inspect provider/model in `ai_usage_log`, Edge logs, production function
deployment versions and CI regression tests. Backups and secrets are never
exposed to browser clients. OpenAI is not attempted after Gemini succeeds.
If both providers fail, show a meaningful error and do not publish an
unvalidated action or AI-derived rate.

## Required Supabase project secret
`GEMINI_API_KEY` (set in Edge Functions > Secrets; no value committed to git).
`OPENAI_API_KEY` remains set for fallback. Both secrets are server-only.

## Optional environment flags
- `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite` (stable 2026 model).
- `GEMINI_DISABLED=true` reverts the updated functions to OpenAI.
- `GEMINI_ALLOW_INTERNAL_CONTENT=false` disables Gemini for **all** internal
  notes and manager review customizations; they use OpenAI.
  Setting `true` or omitting it enables Gemini only for content that passes the
  sensitive-data guard. The guard is heuristic, not a DLP guarantee.
- `OPENAI_FALLBACK_MODEL` defaults to `gpt-4o-mini` for review drafts.
- `GEMINI_OPENAI_MAX_FALLBACKS_PER_ISOLATE` defaults to 20 per hour.
- `GEMINI_OPENAI_FALLBACK_DISABLED=true` prevents OpenAI fallback.

## Privacy and cost
Google's Gemini Developer API unpaid tier may use content for product improvement
and human review. Google's terms say not to submit personal, confidential, or
sensitive data to unpaid services. This implementation allows only ordinary,
low-risk operational text; it detects some obvious identifiers (emails, phone
numbers, room numbers, named guests, health and payroll terms) and sends that
content to OpenAI instead. Detection is not guaranteed to catch everything.
Do not treat this as GDPR compliance certification or a comprehensive DLP tool;
review the data processing arrangements before broad production use. For Gemini
processing of all internal notes, use a paid service with appropriate data
processing terms and privacy review rather than bypassing this guard. Switching
to Gemini does not resolve Supabase compute/egress overages shown in the dashboard.

Gemini quota failures trigger OpenAI fallback. For a genuine organization-wide
fallback spending ceiling, use a durable per-organization counter, not only isolate
memory. Rate, error and usage dashboards should be added before high-volume rollout.

## Validation and deployment
1. Run `deno test --allow-env supabase/functions/_shared/lowCostAi_test.ts`.
2. Test review draft and customization in staging (no auto-publication).
3. Test translations in each required language, including JSON batches.
4. Deploy the four updated functions with their `_shared/lowCostAi.ts` dependency.
5. Confirm production logs show Gemini success and injected 429/5xx triggers OpenAI;
   verify cost/latency and avoid logging customer content.
6. Turn on incrementally. Keep `GEMINI_DISABLED=true` available for rollback.
