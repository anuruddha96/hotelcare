# Give the Hotel Care Assistant web search for general questions

## The gap (verified)

The assistant (`supabase/functions/assistant-chat/index.ts`) runs on the OpenAI Responses API with your `OPENAI_API_KEY`, but it has no way to look anything up on the internet. So questions like "what time does breakfast end at Hotel Ottofiori Brunch and Café" or "is it à la carte or buffet" — facts that live on the venue's website, not in Hotel Care data — get a polite "I couldn't find this" (as in your screenshot).

## What we add

One new tool, available to every assistant user, powered by the OpenAI key that is already stored:

- **OpenAI native web search** added to the assistant's tool set (`webSearchPreview` from `@ai-sdk/openai`, the Responses API built-in tool — no new API keys, no new accounts).
- The model decides when to use it: only for questions Hotel Care data cannot answer — opening hours of cafés/restaurants, city events, weather, transport, general world knowledge. Hotel Care operational data (rooms, revenue, tickets) stays strictly tool-grounded in the database as today; web search never reads or overrides it.
- Prompt rules so answers stay trustworthy:
  - Use web search only when no Hotel Care tool can answer the question.
  - State the answer plainly and name the source (e.g. "according to the café's own site") and that it comes from the web, not from Hotel Care.
  - If the web has no reliable answer, say so instead of guessing.
- **Spend protection**: web search is priced per search, so it gets a per-user daily cap aligned with the existing AI-spend guardrails, and it's skipped entirely when the workspace daily AI budget is exhausted — the chat keeps working, it just says web lookup is temporarily unavailable.
- Answers keep the current style rules: reply in the user's language, lead with the answer, no tool internals mentioned.

## Out of scope

No change to role scoping, hotel/organization isolation, or how operational data is read. Web results are public information; no hotel or guest data is ever sent to the search.

## Technical notes

- All changes confined to `supabase/functions/assistant-chat/index.ts`: add `webSearchPreview({ searchContextSize: "low" })` to the tools passed to `streamText`, add the when-to-use rules to the system prompt, and a lightweight per-user daily counter (reuse the existing spend/audit pattern) before enabling the tool.
- Keep the current model routing unchanged; web search rides on the existing Responses call.
- Validation: deploy, then ask the two screenshot questions (breakfast end time, à la carte vs buffet) plus one operational question, and confirm web answers cite a source while housekeeping answers stay database-grounded.
