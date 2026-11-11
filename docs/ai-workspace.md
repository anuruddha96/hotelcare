# HotelCare AI workspace

The assistant page (`/:org/assistant`) is a full chat workspace on top of the
existing HotelCare assistant. This note covers what was added, how access is
decided, and what has to happen at rollout.

## What it adds

| Area | What | Where |
|---|---|---|
| Workspace | Sidebar with search (Ctrl/Cmd K), projects, pinned and recent chats; rename, move, delete | `src/pages/AssistantPage.tsx`, `src/components/assistant/AssistantSidebar.tsx` |
| Opening screen | "Where to start" cards computed from live data by fixed rules (no AI call, no message used) | `supabase/functions/assistant-priorities`, `AssistantWelcome.tsx` |
| Charts | The model calls `render_chart` with numbers it just read; drawn in the app, with a table view; saved with the answer | `AssistantChart.tsx` |
| Pricing review | `review_pricing`: events, occupancy vs booking window, 7-day pickup, entry rate, competitor median, per-date stance and whole-euro step | `supabase/functions/_shared/pricingReview.ts` |
| Market | `get_competitor_rates` | `_shared/assistantWorkspace.ts` |
| Reputation | `get_reputation_overview` (Google reviews) | same |
| Restaurant | `get_restaurant_reservations` (reservations and covers) | same |
| Images | `generate_image`, 10 per user per day, private bucket `assistant-media` | same |
| Projects | Standing instructions per project, applied to every chat in it | `assistant_projects` |
| Audit | Thread, tokens, duration and workflow per turn | `assistant_audit_log` |

## Access

Nothing new is trusted from the browser. A tool is only registered for a role
that may open the matching screen, and every query is limited to the caller's
organization and authorized hotels.

| Tool | Roles |
|---|---|
| `render_chart` | every assistant role (it can only plot what the role could already read) |
| `review_pricing`, `get_competitor_rates` | revenue scope: admin, top management, manager |
| Applying a price proposal | admin, top management (unchanged `adjust_revenue_prices` rule) |
| `get_reputation_overview` | admin, top management (same as the Reputation screen) |
| `get_restaurant_reservations` | reception scope |
| `generate_image` | admin, top management, manager |

Project instructions are passed as user preferences. They cannot widen access:
the tools a turn has are decided before the instructions are read.

## How a pricing review runs

1. The router sends "review / check / optimise prices for a period" to the
   tool-using agent on the analysis model with high reasoning effort.
2. `review_pricing` returns a stance per night and ready proposals. The euro
   steps come from `pricingReview.ts`, never from the model:
   - never discount a night with 3 or fewer rooms left or a high-impact event;
   - only step down when the competitor scan is under 48 hours old, at least
     two competitors are priced, and our entry rate is more than 5% above their
     median; never below the automation minimum rate;
   - at most 20 euros per step, grouped into ranges of at most 7 nights.
3. Each proposal becomes a confirmation card. Confirming calls the existing
   `assistant-apply-action`, which re-reads the published calendar and uses
   the Revenue publishing queue with all its safety checks.

The same step is applied to every room type and occupancy price of a night.

## Rollout

1. Apply `supabase/migrations/20261111180000_assistant_workspace.sql`.
2. Deploy `assistant-chat`, `assistant-chat-router`, `assistant-priorities`.
3. Optional secrets: `OPENAI_AGENT_MODEL` (model for the pricing review,
   defaults to the standard model) and `OPENAI_IMAGE_MODEL` (defaults to
   `gpt-image-1`).

The functions and the app tolerate the migration being applied later: pins,
projects and saved charts simply stay off until the columns exist.

## Not included yet

- Connecting a staff mailbox (Gmail / Microsoft 365) to read, draft and send.
- Publishing a Google review reply from the chat (today: Reputation screen).
- Writing reservation changes back to Previo.
