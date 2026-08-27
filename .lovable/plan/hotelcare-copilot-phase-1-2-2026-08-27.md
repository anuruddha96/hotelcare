# HotelCare Copilot — Phase 1 & 2

Turn today's assistant into a HotelCare-native copilot: a polished desktop and mobile experience that
knows who you are and where you are, never shows AI internals, can take you to the right page, and can
walk you through a task using the existing training guides. Visibility stays as it is today (admins plus
the pilot user), so nothing changes for other staff while this is tested.

## What changes for the user

- **New assistant surface.** Desktop: a 480px side panel with a HotelCare header showing the property and
  role, plus minimize, new chat, history and an expand-to-workspace control. Mobile: a true full-screen
  view with a large scrollable transcript and a sticky composer that survives the keyboard and iOS safe
  areas.
- **No developer output.** Tool names, parameters, JSON and raw results disappear. While the copilot
  works, the user sees one plain line — "Checking today's housekeeping…", "Finding the right page…" —
  and then the answer. Full traces remain available only behind an admin debug toggle (off by default).
- **Home screen.** Opening the copilot without a conversation shows a greeting, the current property, and
  role- and time-aware starter suggestions instead of today's three revenue prompts.
- **It knows where you are.** Every message carries the current page, tab and selected record, so answers
  are phrased for the screen you are on rather than starting from the main menu.
- **Take me there / Show me.** Answers can offer buttons that open the correct page, or start the existing
  guided walkthrough on that page, highlighting the actual control.
- **Answers as cards.** Metrics, alerts, step lists, navigation and confirmations render as compact cards
  rather than walls of text.
- **Friendlier failures.** Technical errors become plain sentences with "Try again" and "Report a problem".
- **Report a problem.** The user can report an app issue from the conversation; it is emailed to the
  admin address with the full context (route, property, role, conversation extract). The address stays in
  a server secret and is never shown in the app.

## Scope of this plan

Phases 1 and 2 only, as agreed. Write actions (housekeeping assignment, maintenance tickets, invoice
workflow) and the wider read coverage are **not** implemented here, but the capability registry, action
safety levels and confirmation card contract are built now so those phases slot in without rework. The
existing revenue automation proposal/confirm flow keeps working unchanged.

## Technical notes

**Frontend**
- `src/lib/assistant/navigationRegistry.ts` — one typed registry of destinations (id, label, route
  builder, tab/sub-tab, allowed roles, matching training guide, optional selectors) covering the tenant
  routes and the tabs inside them. The model may only return a registry `id`; the frontend resolves and
  access-checks it before navigating. Registry ids are also sent to the backend so the model cannot
  invent routes.
- `src/hooks/useAssistantContext.ts` — derives organization, property, role, route, module, tab, entity
  type/id, language and device from the existing auth/tenant contexts and the URL. UX only; the backend
  re-derives authorization from the JWT.
- `src/components/assistant/` rebuilt around the existing AI Elements primitives: `AssistantShell`
  (responsive panel/full-screen/workspace), `AssistantHome`, `AssistantTranscript`, `AssistantComposer`,
  and a `cards/` folder (metric, alert, steps, navigation, confirmation, issue, error). `Tool*` rendering
  is replaced by an `ActivityLine` driven by a friendly label map keyed on tool name.
- `AssistantLauncher` and `AssistantPage` become thin wrappers over the shell; thread state is lifted to
  one owner so panel and page share it. Existing thread URLs keep working.
- "Show me" dispatches into the existing training guide/tour provider (`TrainingV2Provider`,
  `TrainingOverlayV2`) after navigating, with a graceful fallback to a written step list when a selector
  is missing.

**Backend (`supabase/functions/assistant-chat`)**
- Split the monolith into `_shared/assistant/`: `permissions.ts` (effective scopes from profile + live
  approved access grants), `context.ts` (validated envelope), `capabilities/` (one module per area
  declaring its tools, required scopes and action level), and a `router.ts` that classifies the request
  and passes only the relevant capability's tools to the model. Navigation and training/help capabilities
  are new; the existing revenue tools move across unchanged.
- New tools this phase: `find_destination` (searches the navigation registry, returns registry ids only)
  and `get_training_guide` (reads `training_guides` / `training_guide_steps` scoped to the user's role and
  organization) — replacing the hard-coded `HOW_TO` string.
- Structured response contract: the model returns cards and actions through a dedicated tool whose output
  the frontend validates against the registry, instead of the UI parsing free text.
- Model tiering: a fast tier for navigation/help/lookup, standard for operational summaries, advanced for
  revenue analysis. Model names are never surfaced to users.
- Prompt-injection guard: all database-sourced text is wrapped as untrusted data in the prompt.
- Per-user rate limiting and privacy-conscious audit rows on the existing `assistant_audit_log`.
- New edge function `assistant-report-issue`: validates the caller, composes the report, emails it via the
  existing Resend configuration to an address held in a new secret, and records an audit row.

**Database**
- `assistant_issue_reports` (organization, hotel, user, thread, category, severity, description, AI
  summary, route/module/tab, entity, device, status, timestamps) with GRANTs and RLS: authors read their
  own rows, admins read all.
- `assistant_feedback` (thread, message, helpful, reason) with the same pattern, for the thumbs control.
- No changes to existing tables.

**Secrets**
- One new secret for the issue-report recipient address.

## Validation

- iPhone-sized viewport: open, focus without zoom, type, keyboard open/close, send, stream, composer stays
  visible; desktop panel and workspace at 1280 and 1920.
- Confirm no tool name, parameter or JSON is reachable in the DOM as a non-debug user.
- Navigation: allowed destination opens correctly; a destination outside the role is refused.
- "Show me" opens the right page and starts the right guide, and degrades to text when the selector is gone.
- Cross-tenant checks: an SLNT user gets nothing from RD Hotels and vice versa.
- Issue report arrives by email with full context and creates a row; the recipient address is absent from
  the client bundle.
- Existing revenue automation proposal → apply flow still works end to end.
