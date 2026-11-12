# HotelCare Gemini-first low-cost AI rollout

## Goal
Reduce OpenAI costs on small text tasks using the server-side `GEMINI_API_KEY` first.
OpenAI remains the automatic fallback for provider errors, invalid content and quota
exhaustion, bounded to 20 fallback calls per Edge Function isolate per hour by default.
The per-isolate limit is **not** an organization-wide spend cap.

## Scope
- `google-reputation`: public Google review drafts use Gemini first; curated
  positive-review replies remain free and are unchanged. Three-alternative manager
  customizations contain private manager notes and stay on OpenAI unless explicitly opted in.
- `google-reputation-worker`: scheduled public review drafts use Gemini first.
  Existing automated-publishing risk checks are not modified.
- `translate-room-types`: cached, non-confidential room-type names use Gemini first.
- `translate-note`: potentially sensitive housekeeping/maintenance text remains on
  the current OpenAI route unless `GEMINI_ALLOW_INTERNAL_CONTENT=true`.

Revenue recommendations, high-stakes pricing, assistant tool calling, and image
processing are deliberately unchanged. Evaluate those separately.

## Required Supabase project secret
`GEMINI_API_KEY` (set in Edge Functions > Secrets; no value committed to git).
`OPENAI_API_KEY` remains set for fallback. Both secrets are server-only.

## Optional environment flags
- `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite` (stable 2026 model).
- `GEMINI_DISABLED=true` reverts the updated functions to OpenAI.
- `GEMINI_ALLOW_INTERNAL_CONTENT=true` enables Gemini for notes and
  manager review customizations **only after an appropriate privacy assessment**.
- `OPENAI_FALLBACK_MODEL` defaults to `gpt-4o-mini` for review drafts.
- `GEMINI_OPENAI_MAX_FALLBACKS_PER_ISOLATE` defaults to 20 per hour.
- `GEMINI_OPENAI_FALLBACK_DISABLED=true` prevents OpenAI fallback.

## Privacy and cost
As of November 2026 Google's Gemini Developer API free tier may use submitted
content to improve its products. Do not use it for confidential guest, employee, or
commercial information without verifying data-processing terms, lawful basis and
international transfer requirements. Public reviews may also include personal data;
monitor prompts for accidental sensitive details. Switching to Gemini does not
resolve Supabase compute/egress overages shown in the dashboard.

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
